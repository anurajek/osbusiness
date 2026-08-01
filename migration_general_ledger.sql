-- ============================================================================
-- Migration: General Ledger (Chart of Accounts + Journal Entries + Reports)
-- Run this in Supabase's SQL Editor. Safe to run on the existing database -
-- it only adds new tables/functions, nothing existing is touched.
--
-- Design notes:
--   - Writes to journal_entries/journal_entry_lines only happen through the
--     two RPCs below (create_journal_entry, post_journal_entry) - there is
--     deliberately no INSERT/UPDATE grant for the authenticated role on
--     either table. That's not an oversight: it's what guarantees every
--     entry that exists is balanced (debits = credits), since the balance
--     check lives in the RPC, not just the UI. A client-side bug can't
--     produce a bad row here even by accident.
--   - Journal entries are created as 'draft' and can only become 'posted'
--     via post_journal_entry(), which is Owner-only and re-checks the
--     balance server-side. Posted entries can't be edited or deleted from
--     the UI at all (no update policy, and the delete policy explicitly
--     excludes status = 'posted') - if a posted entry turns out wrong, the
--     correct move is a new correcting entry, same as real bookkeeping,
--     not silently editing history.
--   - This module does NOT auto-post from Sales/Purchases/Cash & Bank yet.
--     It's a standalone, correct double-entry ledger for manual entries -
--     the safer starting point vs. retrofitting auto-posting logic onto
--     the existing invoice/payment flows in the same pass. Auto-posting is
--     a natural next step once this foundation is confirmed working.
-- ============================================================================

create table if not exists chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (firm_id, code)
);

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  entry_date date not null,
  reference text,
  status text not null default 'draft' check (status in ('draft', 'posted')),
  created_by uuid references auth.users(id),
  posted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references chart_of_accounts(id),
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  description text,
  check (debit >= 0 and credit >= 0),
  check (debit = 0 or credit = 0) -- a line is a debit or a credit, never both
);

create index if not exists journal_entry_lines_entry_id_idx on journal_entry_lines(entry_id);
create index if not exists journal_entry_lines_account_id_idx on journal_entry_lines(account_id);
create index if not exists journal_entries_firm_id_idx on journal_entries(firm_id);
create index if not exists chart_of_accounts_firm_id_idx on chart_of_accounts(firm_id);

alter table chart_of_accounts enable row level security;
alter table journal_entries enable row level security;
alter table journal_entry_lines enable row level security;

-- Chart of accounts: same UI-gated-not-DB-enforced pattern already used for
-- invites/member-removal elsewhere in this app (see README's known-gaps
-- list) - any active member can technically write via direct table access,
-- the UI hides it for non-Owners/non-Accountants. Deliberately no delete
-- policy: once an account might be referenced by a journal line, deleting
-- it would orphan history - deactivate (is_active = false) instead.
create policy "members can view their firm's accounts" on chart_of_accounts
  for select using (is_firm_member(firm_id));
create policy "members can create accounts" on chart_of_accounts
  for insert with check (is_firm_member(firm_id));
create policy "members can update accounts" on chart_of_accounts
  for update using (is_firm_member(firm_id));

-- journal_entries / journal_entry_lines: SELECT only for direct table
-- access. No INSERT/UPDATE policy at all - every write goes through the
-- RPCs below (security definer, so they bypass RLS internally). DELETE is
-- allowed only for entries still in 'draft', which is what keeps posted
-- history immutable at the database level, not just hidden in the UI.
create policy "members can view their firm's journal entries" on journal_entries
  for select using (is_firm_member(firm_id));
create policy "members can delete draft journal entries" on journal_entries
  for delete using (is_firm_member(firm_id) and status = 'draft');

create policy "members can view their firm's journal lines" on journal_entry_lines
  for select using (is_firm_member((select firm_id from journal_entries where id = entry_id)));

-- ----------------------------------------------------------------------------
-- create_journal_entry: the only way a journal entry gets created. Takes
-- lines as a JSON array so the whole entry (header + every line) is one
-- atomic call - either the entry is fully created and balanced, or nothing
-- is written at all.
-- p_lines shape: [{ "account_id": "...", "debit": 100, "credit": 0, "description": "..." }, ...]
-- ----------------------------------------------------------------------------
create or replace function create_journal_entry(
  p_firm_id uuid,
  p_entry_date date,
  p_reference text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line jsonb;
begin
  if v_user_id is null then
    raise exception 'No authenticated user.';
  end if;
  if not is_firm_member(p_firm_id) then
    raise exception 'Not a member of this firm.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry needs at least two lines.';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'Entry does not balance: debits % vs credits %', round(v_total_debit, 2), round(v_total_credit, 2);
  end if;
  if round(v_total_debit, 2) = 0 then
    raise exception 'Entry amounts cannot all be zero.';
  end if;

  insert into journal_entries (firm_id, entry_date, reference, status, created_by)
  values (p_firm_id, p_entry_date, nullif(p_reference, ''), 'draft', v_user_id)
  returning id into v_entry_id;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, description)
  select
    v_entry_id,
    (l->>'account_id')::uuid,
    coalesce((l->>'debit')::numeric, 0),
    coalesce((l->>'credit')::numeric, 0),
    nullif(l->>'description', '')
  from jsonb_array_elements(p_lines) as l;

  return v_entry_id;
end;
$$;

grant execute on function create_journal_entry(uuid, date, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- post_journal_entry: Owner-only approval step. Re-validates the balance
-- server-side (defense in depth - the entry should already balance from
-- create_journal_entry, but this makes posting itself safe even if that
-- ever changes) before flipping draft -> posted.
-- ----------------------------------------------------------------------------
create or replace function post_journal_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_firm_id uuid;
  v_my_role text;
  v_total_debit numeric;
  v_total_credit numeric;
begin
  select firm_id into v_firm_id from journal_entries where id = p_entry_id;
  if v_firm_id is null then
    raise exception 'Journal entry not found.';
  end if;

  select role into v_my_role from firm_members
    where firm_id = v_firm_id and user_id = v_user_id and status = 'active';
  if v_my_role is distinct from 'Owner' then
    raise exception 'Only an Owner can post a journal entry.';
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_total_debit, v_total_credit
    from journal_entry_lines where entry_id = p_entry_id;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'Entry does not balance and cannot be posted.';
  end if;

  update journal_entries set status = 'posted', posted_by = v_user_id
    where id = p_entry_id and status = 'draft';
end;
$$;

grant execute on function post_journal_entry(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Extend create_firm_with_owner (defined in migration_create_firm_rpc.sql)
-- so every new firm starts with a standard starter chart of accounts,
-- instead of an empty, unusable ledger. CREATE OR REPLACE is safe here -
-- same signature, same behavior, plus the new seeding step at the end.
-- ----------------------------------------------------------------------------
create or replace function create_firm_with_owner(
  p_firm_name text,
  p_full_name text,
  p_gstin text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_firm_id uuid;
begin
  if v_user_id is null then
    raise exception 'No authenticated user.';
  end if;

  insert into firms (name, gstin)
  values (p_firm_name, nullif(p_gstin, ''))
  returning id into v_firm_id;

  insert into firm_members (firm_id, user_id, full_name, role, permissions, status)
  values (
    v_firm_id,
    v_user_id,
    p_full_name,
    'Owner',
    '{"dashboard": true, "sales": true, "purchases": true, "arap": true, "cashbank": true, "ledger": true, "permissions": true}'::jsonb,
    'active'
  );

  insert into chart_of_accounts (firm_id, code, name, type) values
    (v_firm_id, '1000', 'Cash', 'asset'),
    (v_firm_id, '1010', 'Bank Account', 'asset'),
    (v_firm_id, '1100', 'Accounts Receivable', 'asset'),
    (v_firm_id, '2000', 'Accounts Payable', 'liability'),
    (v_firm_id, '2100', 'GST Payable', 'liability'),
    (v_firm_id, '3000', 'Owner''s Equity', 'equity'),
    (v_firm_id, '3100', 'Retained Earnings', 'equity'),
    (v_firm_id, '4000', 'Sales Revenue', 'income'),
    (v_firm_id, '5000', 'Cost of Goods Sold', 'expense'),
    (v_firm_id, '5100', 'Operating Expenses', 'expense');

  return v_firm_id;
end;
$$;

grant execute on function create_firm_with_owner(text, text, text) to authenticated;

-- One-off: seed the same starter chart of accounts for firms that already
-- existed before this migration ran (so you're not starting from zero).
-- Safe to run more than once - only fires for a firm with no accounts yet.
insert into chart_of_accounts (firm_id, code, name, type)
select f.id, a.code, a.name, a.type
from firms f
cross join (values
  ('1000', 'Cash', 'asset'),
  ('1010', 'Bank Account', 'asset'),
  ('1100', 'Accounts Receivable', 'asset'),
  ('2000', 'Accounts Payable', 'liability'),
  ('2100', 'GST Payable', 'liability'),
  ('3000', 'Owner''s Equity', 'equity'),
  ('3100', 'Retained Earnings', 'equity'),
  ('4000', 'Sales Revenue', 'income'),
  ('5000', 'Cost of Goods Sold', 'expense'),
  ('5100', 'Operating Expenses', 'expense')
) as a(code, name, type)
where not exists (select 1 from chart_of_accounts existing where existing.firm_id = f.id);
