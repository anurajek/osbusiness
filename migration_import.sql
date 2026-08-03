-- ============================================================================
-- Migration: Bulk Import (Customers, Suppliers, Sales Invoices, Purchase Bills)
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Every bulk import is grouped under one `import_batches` row, and every
-- row it creates is tagged with that batch's id. This is what makes "Undo
-- this import" possible on the Import screen - importing real accounting
-- data in bulk (from a Tally/Zoho export, say) with no way to cleanly
-- reverse a mistake would be a genuinely risky feature to ship without one.
-- ============================================================================

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  target_type text not null check (target_type in ('customers', 'suppliers', 'sales_invoices', 'purchase_bills')),
  source_filename text,
  row_count integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table customers add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table suppliers add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table sales_invoices add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table purchase_bills add column if not exists import_batch_id uuid references import_batches(id) on delete set null;

create index if not exists import_batches_firm_id_idx on import_batches(firm_id);

alter table import_batches enable row level security;

create policy "members can view their firm's import batches" on import_batches
  for select using (is_firm_member(firm_id));
create policy "members can create import batches" on import_batches
  for insert with check (is_firm_member(firm_id));
create policy "members can delete their firm's import batches" on import_batches
  for delete using (is_firm_member(firm_id));

-- The app has deliberately never supported deleting a manually-entered
-- invoice/bill/customer/supplier (see README). "Undo this import" needs
-- *some* delete path, so these policies allow deleting a row only when it
-- was actually created by a bulk import (import_batch_id is not null) -
-- manually-entered records stay exactly as protected as they were before.
create policy "members can delete their firm's imported customers" on customers
  for delete using (is_firm_member(firm_id) and import_batch_id is not null);
create policy "members can delete their firm's imported suppliers" on suppliers
  for delete using (is_firm_member(firm_id) and import_batch_id is not null);
create policy "members can delete their firm's imported sales invoices" on sales_invoices
  for delete using (is_firm_member(firm_id) and import_batch_id is not null);
create policy "members can delete their firm's imported purchase bills" on purchase_bills
  for delete using (is_firm_member(firm_id) and import_batch_id is not null);

-- ----------------------------------------------------------------------------
-- Add the new "import" permission key to create_firm_with_owner's default
-- Owner permissions - bulk data import is sensitive enough to gate
-- separately, same reasoning as why "permissions" itself is gated.
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
    '{"dashboard": true, "sales": true, "purchases": true, "quotes": true, "notes": true, "arap": true, "cashbank": true, "ledger": true, "import": true, "permissions": true}'::jsonb,
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
