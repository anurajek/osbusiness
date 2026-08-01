-- ============================================================================
-- Migration: Quotations (with itemized line items)
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- This is the first itemized document in the app - sales_invoices and
-- purchase_bills are still single-amount records (see README). Quotations
-- got line items first, deliberately, on a brand-new feature with no
-- existing data to migrate or risk, rather than retrofitting the schema
-- underneath live invoices in the same pass. "Convert to Invoice" carries
-- the quote's line-item total across as the invoice's single amount for
-- now; the itemized detail lives on the quote (and its PDF) until invoices
-- get the same treatment as a later, separate pass.
-- ============================================================================

alter table firms add column if not exists quote_prefix text not null default 'QUO-';
alter table firms add column if not exists next_quote_number integer not null default 1;

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  customer_id uuid not null references customers(id),
  quote_no text not null,
  issued_date date not null,
  valid_until date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'converted')),
  notes text,
  converted_invoice_id uuid references sales_invoices(id),
  created_at timestamptz not null default now()
);

create table if not exists quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  description text not null,
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  amount numeric(14, 2) generated always as (quantity * unit_price) stored,
  sort_order integer not null default 0
);

create index if not exists quotes_firm_id_idx on quotes(firm_id);
create index if not exists quotes_customer_id_idx on quotes(customer_id);
create index if not exists quote_line_items_quote_id_idx on quote_line_items(quote_id);

alter table quotes enable row level security;
alter table quote_line_items enable row level security;

-- Same permissive, UI-gated pattern already used for customers/suppliers/
-- sales_invoices elsewhere in this app - any active firm member can read
-- and write; the UI decides who sees the button (see README's known-gaps
-- list, which already covers this same class of thing for other tables).
create policy "members can view their firm's quotes" on quotes
  for select using (is_firm_member(firm_id));
create policy "members can create quotes" on quotes
  for insert with check (is_firm_member(firm_id));
create policy "members can update quotes" on quotes
  for update using (is_firm_member(firm_id));
create policy "members can delete quotes" on quotes
  for delete using (is_firm_member(firm_id));

create policy "members can view their firm's quote line items" on quote_line_items
  for select using (is_firm_member((select firm_id from quotes where id = quote_id)));
create policy "members can create quote line items" on quote_line_items
  for insert with check (is_firm_member((select firm_id from quotes where id = quote_id)));
create policy "members can update quote line items" on quote_line_items
  for update using (is_firm_member((select firm_id from quotes where id = quote_id)));
create policy "members can delete quote line items" on quote_line_items
  for delete using (is_firm_member((select firm_id from quotes where id = quote_id)));

-- ----------------------------------------------------------------------------
-- next_quote_number: same atomic-counter pattern as next_sales_invoice_number
-- in migration_branding_numbering.sql - UPDATE...RETURNING makes it safe
-- against two people creating a quote at the same moment.
-- ----------------------------------------------------------------------------
create or replace function next_quote_number(p_firm_id uuid)
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

  update firms
    set next_quote_number = next_quote_number + 1
    where id = p_firm_id
    returning quote_prefix, next_quote_number - 1
    into v_prefix, v_number;

  if v_number is null then
    raise exception 'Firm not found.';
  end if;

  return v_prefix || lpad(v_number::text, 4, '0');
end;
$$;

grant execute on function next_quote_number(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Add the new "quotes" permission key to create_firm_with_owner's default
-- Owner permissions, same pattern as when "ledger" was added in
-- migration_general_ledger.sql. CREATE OR REPLACE is safe - same
-- signature, same behavior, one more key in the permissions JSON.
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
    '{"dashboard": true, "sales": true, "purchases": true, "arap": true, "cashbank": true, "ledger": true, "quotes": true, "permissions": true}'::jsonb,
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
