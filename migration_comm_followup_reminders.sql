-- ============================================================================
-- Migration: Comm log mentions, assignment, and self-reminders
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Adds three things to both ar_comms (customer-facing) and supplier_comms
-- (supplier-facing) - the two tables behind the shared CommDrawer used by
-- Receivables, Payables, and Invoice/PI Follow-up:
--
-- 1. assigned_to - who owns the next follow-up action on this log entry.
--    A plain firm_members reference, not a new role hierarchy - whichever
--    member should chase this, picked freely per entry.
-- 2. remind_on / reminder_done - a self-set "remind me on this date" flag.
--    Deliberately separate from the existing automatic email-reminder
--    infrastructure (reminders_paused / last_reminder_stage on
--    sales_invoices / proforma_invoices, see migration_pi_and_reminders.sql)
--    - that's the system sending emails on its own schedule; this is a
--    personal internal nudge for whoever it's assigned to, surfaced on the
--    Dashboard and as a highlighted row on Receivables/Payables/Invoice-PI
--    Follow-up once its date arrives.
-- 3. mentioned_member_ids - firm members @mentioned inside the note text,
--    so it's visible who's been looped in on a given update.
--
-- Also adds an UPDATE policy to both tables - they previously only had
-- select/insert (comms were originally an append-only log), which would
-- have silently failed any attempt to mark a reminder done.
-- ============================================================================

alter table ar_comms add column if not exists assigned_to uuid references firm_members(id) on delete set null;
alter table ar_comms add column if not exists remind_on date;
alter table ar_comms add column if not exists reminder_done boolean not null default false;
alter table ar_comms add column if not exists mentioned_member_ids uuid[] not null default '{}';

alter table supplier_comms add column if not exists assigned_to uuid references firm_members(id) on delete set null;
alter table supplier_comms add column if not exists remind_on date;
alter table supplier_comms add column if not exists reminder_done boolean not null default false;
alter table supplier_comms add column if not exists mentioned_member_ids uuid[] not null default '{}';

-- Partial index - only rows that could actually show up in "what's due"
-- queries (Dashboard's reminder list, the row-highlight check) are indexed,
-- since resolved reminders never need to be found that way again.
create index if not exists ar_comms_reminder_idx on ar_comms(firm_id, assigned_to, remind_on) where reminder_done = false;
create index if not exists supplier_comms_reminder_idx on supplier_comms(firm_id, assigned_to, remind_on) where reminder_done = false;

drop policy if exists "members can update their firm's ar comms" on ar_comms;
create policy "members can update their firm's ar comms" on ar_comms
  for update using (is_firm_member(firm_id));

drop policy if exists "members can update their firm's supplier comms" on supplier_comms;
create policy "members can update their firm's supplier comms" on supplier_comms
  for update using (is_firm_member(firm_id));
