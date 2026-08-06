-- ============================================================================
-- Migration: Proforma Invoices + Payment Reminders
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Two things, built together because they share the same tracking fields:
--
-- 1. Proforma Invoices - a document type parallel to (not converted into)
--    Sales Invoices. This tool never generates or converts either one -
--    both arrive here via CSV import from Tally/Zoho/wherever, and are
--    tracked side by side in AR/AP so a firm can follow up on whichever
--    one (or both) matches how they actually work.
--
-- 2. Payment reminder infrastructure - who to email, whether reminders are
--    paused, and what's already been sent - shared by both Sales Invoices
--    and Proforma Invoices, since the same reminder schedule applies to
--    whichever document a firm is actually following up on.
-- ============================================================================

alter table firms add column if not exists reminder_grace_days integer not null default 7;
alter table firms add column if not exists pi_prefix text not null default 'PI-';
alter table firms add column if not exists next_pi_number integer not null default 1;

-- import_batches.target_type's original CHECK constraint (from
-- migration_import.sql) doesn't include proforma_invoices - it would
-- reject that import outright. Widening it here rather than editing the
-- original migration, since that one already ran and can't be re-run.
alter table import_batches drop constraint if exists import_batches_target_type_check;
alter table import_batches add constraint import_batches_target_type_check
  check (target_type in ('customers', 'suppliers', 'sales_invoices', 'purchase_bills', 'proforma_invoices'));

create table if not exists proforma_invoices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  customer_id uuid not null references customers(id),
  pi_no text not null,
  issued_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  paid_amount numeric(14, 2) not null default 0,
  status text not null default 'Sent',
  import_batch_id uuid references import_batches(id) on delete set null,
  reminders_paused boolean not null default false,
  last_reminder_stage text,
  last_reminder_sent_date date,
  created_at timestamptz not null default now()
);

create index if not exists proforma_invoices_firm_id_idx on proforma_invoices(firm_id);
create index if not exists proforma_invoices_customer_id_idx on proforma_invoices(customer_id);

alter table proforma_invoices enable row level security;

create policy "members can view their firm's proforma invoices" on proforma_invoices
  for select using (is_firm_member(firm_id));
create policy "members can create proforma invoices" on proforma_invoices
  for insert with check (is_firm_member(firm_id));
create policy "members can update proforma invoices" on proforma_invoices
  for update using (is_firm_member(firm_id));
create policy "members can delete their firm's imported proforma invoices" on proforma_invoices
  for delete using (is_firm_member(firm_id) and import_batch_id is not null);

-- Same atomic-counter pattern as next_sales_invoice_number/next_quote_number.
create or replace function next_pi_number(p_firm_id uuid)
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
  update firms set next_pi_number = next_pi_number + 1
    where id = p_firm_id
    returning pi_prefix, next_pi_number - 1
    into v_prefix, v_number;
  if v_number is null then
    raise exception 'Firm not found.';
  end if;
  return v_prefix || lpad(v_number::text, 4, '0');
end;
$$;

grant execute on function next_pi_number(uuid) to authenticated;

-- Reminder tracking fields on Sales Invoices - Proforma Invoices already
-- got theirs above at table-creation time.
alter table sales_invoices add column if not exists reminders_paused boolean not null default false;
alter table sales_invoices add column if not exists last_reminder_stage text;
alter table sales_invoices add column if not exists last_reminder_sent_date date;

-- Who a customer's reminder emails go to - a separate table (not a single
-- column) specifically so emails can be added or removed over time without
-- ever needing a schema change, matching "we might add or remove these
-- later" directly. Kept at the customer level (not per-document) so it's
-- set up once per customer and applies to all their pending PIs/invoices,
-- rather than re-entering the same emails for every single document.
create table if not exists customer_reminder_emails (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (customer_id, email)
);

alter table customer_reminder_emails enable row level security;

create policy "members can view their firm's reminder emails" on customer_reminder_emails
  for select using (is_firm_member((select firm_id from customers where id = customer_id)));
create policy "members can add reminder emails" on customer_reminder_emails
  for insert with check (is_firm_member((select firm_id from customers where id = customer_id)));
create policy "members can remove reminder emails" on customer_reminder_emails
  for delete using (is_firm_member((select firm_id from customers where id = customer_id)));

-- A log of every reminder actually sent (manual or automatic) - separate
-- from ar_comms (which is for the Owner/Accountant's own notes about
-- talking to a client) since this is specifically an audit trail of what
-- the system itself sent and when, not something a person typed.
create table if not exists payment_reminders_log (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  document_type text not null check (document_type in ('invoice', 'proforma_invoice')),
  document_id uuid not null,
  stage text not null,
  sent_to text not null,
  sent_at timestamptz not null default now(),
  triggered_by text not null check (triggered_by in ('manual', 'automatic'))
);

create index if not exists payment_reminders_log_document_idx on payment_reminders_log(document_type, document_id);

alter table payment_reminders_log enable row level security;

create policy "members can view their firm's reminder log" on payment_reminders_log
  for select using (is_firm_member(firm_id));

-- Writes to this log only ever happen from inside the send-payment-reminder
-- Edge Function (via the service role, which bypasses RLS entirely) - no
-- insert policy needed for the authenticated/anon roles.
