-- ============================================================================
-- Migration: Credit Notes & Debit Notes
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Credit notes (sales side) and debit notes (purchase side) are their own
-- independent records, not a retroactive edit to the original invoice/bill.
-- `original_invoice_id`/`original_bill_id` is optional context for the
-- audit trail only - creating or refunding a note never touches the linked
-- invoice/bill's amount or paid_amount. This matches how a credit note
-- works in practice: if a fully-paid invoice later gets a partial refund,
-- the invoice is still correctly "Paid" (the customer did pay it) - the
-- refund is its own transaction, not a rewrite of history.
--
-- Money direction on refund is the important, easy-to-get-backwards part:
--   - Credit note (money back TO a customer) = cash OUT, same direction as
--     a purchase payment.
--   - Debit note (money back FROM a supplier) = cash IN, same direction as
--     a sales payment.
-- i.e. the sign is the OPPOSITE of what "sales vs purchases" would suggest
-- at a glance - see the inline comments in CreditDebitNoteScreen.jsx.
-- ============================================================================

alter table firms add column if not exists credit_note_prefix text not null default 'CN-';
alter table firms add column if not exists next_credit_note_number integer not null default 1;
alter table firms add column if not exists debit_note_prefix text not null default 'DN-';
alter table firms add column if not exists next_debit_note_number integer not null default 1;

create table if not exists credit_notes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  customer_id uuid not null references customers(id),
  note_no text not null,
  issued_date date not null,
  reason text,
  amount numeric(14, 2) not null check (amount > 0),
  original_invoice_id uuid references sales_invoices(id),
  status text not null default 'open' check (status in ('open', 'refunded')),
  refunded_via_account_id uuid references bank_accounts(id),
  refunded_date date,
  created_at timestamptz not null default now()
);

create table if not exists debit_notes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  note_no text not null,
  issued_date date not null,
  reason text,
  amount numeric(14, 2) not null check (amount > 0),
  original_bill_id uuid references purchase_bills(id),
  status text not null default 'open' check (status in ('open', 'refunded')),
  refunded_via_account_id uuid references bank_accounts(id),
  refunded_date date,
  created_at timestamptz not null default now()
);

create index if not exists credit_notes_firm_id_idx on credit_notes(firm_id);
create index if not exists debit_notes_firm_id_idx on debit_notes(firm_id);

alter table credit_notes enable row level security;
alter table debit_notes enable row level security;

-- Same permissive, UI-gated pattern already used for customers/suppliers/
-- invoices/bills elsewhere in this app (see README's known-gaps list).
create policy "members can view their firm's credit notes" on credit_notes
  for select using (is_firm_member(firm_id));
create policy "members can create credit notes" on credit_notes
  for insert with check (is_firm_member(firm_id));
create policy "members can update credit notes" on credit_notes
  for update using (is_firm_member(firm_id));
create policy "members can delete credit notes" on credit_notes
  for delete using (is_firm_member(firm_id));

create policy "members can view their firm's debit notes" on debit_notes
  for select using (is_firm_member(firm_id));
create policy "members can create debit notes" on debit_notes
  for insert with check (is_firm_member(firm_id));
create policy "members can update debit notes" on debit_notes
  for update using (is_firm_member(firm_id));
create policy "members can delete debit notes" on debit_notes
  for delete using (is_firm_member(firm_id));

-- ----------------------------------------------------------------------------
-- Numbering: same atomic UPDATE...RETURNING pattern as
-- next_sales_invoice_number / next_quote_number.
-- ----------------------------------------------------------------------------
create or replace function next_credit_note_number(p_firm_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number integer;
begin
  if not is_firm_member(p_firm_id) then
    raise exception 'Not a member of this firm.';
  end if;
  update firms set next_credit_note_number = next_credit_note_number + 1
    where id = p_firm_id
    returning credit_note_prefix, next_credit_note_number - 1
    into v_prefix, v_number;
  if v_number is null then
    raise exception 'Firm not found.';
  end if;
  return v_prefix || lpad(v_number::text, 4, '0');
end;
$$;

create or replace function next_debit_note_number(p_firm_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number integer;
begin
  if not is_firm_member(p_firm_id) then
    raise exception 'Not a member of this firm.';
  end if;
  update firms set next_debit_note_number = next_debit_note_number + 1
    where id = p_firm_id
    returning debit_note_prefix, next_debit_note_number - 1
    into v_prefix, v_number;
  if v_number is null then
    raise exception 'Firm not found.';
  end if;
  return v_prefix || lpad(v_number::text, 4, '0');
end;
$$;

grant execute on function next_credit_note_number(uuid) to authenticated;
grant execute on function next_debit_note_number(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Add the new "notes" permission key to create_firm_with_owner's default
-- Owner permissions, same pattern as when "ledger" and "quotes" were added.
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
    '{"dashboard": true, "sales": true, "purchases": true, "quotes": true, "notes": true, "arap": true, "cashbank": true, "ledger": true, "permissions": true}'::jsonb,
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
