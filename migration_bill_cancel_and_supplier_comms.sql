-- ============================================================================
-- Migration: Bill cancellation + supplier communication log
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- 1. is_cancelled on purchase_bills - a real workflow state, not another
--    manual tag: a cancelled bill is excluded from every pending/amount-due
--    calculation on Payables (same as a fully-paid one), rather than just
--    being labeled differently while still counting toward what's owed.
--
-- 2. supplier_comms - the Payables-side equivalent of ar_comms, which only
--    ever existed for customers. This is what finally lets Payables get
--    the same update-log drawer and "Actions..." menu Receivables has -
--    there was nowhere to store a supplier follow-up note before this.
-- ============================================================================

alter table purchase_bills add column if not exists is_cancelled boolean not null default false;

create table if not exists supplier_comms (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  channel text not null,
  tag text not null,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists supplier_comms_supplier_id_idx on supplier_comms(supplier_id);

alter table supplier_comms enable row level security;

create policy "members can view their firm's supplier comms" on supplier_comms
  for select using (is_firm_member(firm_id));
create policy "members can add supplier comms" on supplier_comms
  for insert with check (is_firm_member(firm_id));
