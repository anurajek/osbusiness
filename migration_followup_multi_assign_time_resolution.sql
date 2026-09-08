-- ============================================================================
-- Migration: Multiple assignees, reminder time, resolution notes, and
-- document-level assignment on Invoice/PI
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
-- Depends on migration_comm_followup_reminders.sql having already run.
--
-- Follow-up refinements after real use (Sep 2026):
--
-- 1. assigned_to_ids (plural) replaces assigned_to (singular) on ar_comms/
--    supplier_comms - a follow-up often genuinely needs more than one
--    person looped in (e.g. the Executive who calls + the Senior Accountant
--    who needs to know). The old singular assigned_to column is kept as-is
--    (not dropped - it may still have real data) and backfilled into the
--    new array column; the app itself stops reading/writing the old column
--    from this point on.
-- 2. remind_time - an optional time-of-day alongside the existing remind_on
--    date. Kept as a separate nullable column rather than upgrading
--    remind_on to a timestamp, so every existing date-only reminder and
--    every "is this due yet" comparison already in the app keeps working
--    unchanged - remind_time is purely additive display/scheduling detail.
-- 3. resolution_note - what actually happened when a reminder was marked
--    done. Optional: dismissing a reminder with nothing to report still
--    works exactly as before, this just gives "Mark done" a place to
--    capture the outcome when there is one, instead of the response
--    disappearing the moment the reminder is dismissed.
-- 4. assigned_to_ids on sales_invoices/proforma_invoices - lets ownership
--    be set the moment a PI is added (or an existing Invoice/PI edited),
--    not only after the fact via a comm log entry. Separate concept from
--    the comm-log-level assignment above: this is "who generally owns
--    this document," that's "who owns this specific logged follow-up."
-- ============================================================================

alter table ar_comms add column if not exists assigned_to_ids uuid[] not null default '{}';
update ar_comms set assigned_to_ids = array[assigned_to]
  where assigned_to is not null and coalesce(array_length(assigned_to_ids, 1), 0) = 0;
alter table ar_comms add column if not exists remind_time time;
alter table ar_comms add column if not exists resolution_note text;

alter table supplier_comms add column if not exists assigned_to_ids uuid[] not null default '{}';
update supplier_comms set assigned_to_ids = array[assigned_to]
  where assigned_to is not null and coalesce(array_length(assigned_to_ids, 1), 0) = 0;
alter table supplier_comms add column if not exists remind_time time;
alter table supplier_comms add column if not exists resolution_note text;

create index if not exists ar_comms_assigned_to_ids_gin on ar_comms using gin (assigned_to_ids);
create index if not exists supplier_comms_assigned_to_ids_gin on supplier_comms using gin (assigned_to_ids);

alter table sales_invoices add column if not exists assigned_to_ids uuid[] not null default '{}';
alter table proforma_invoices add column if not exists assigned_to_ids uuid[] not null default '{}';

create index if not exists sales_invoices_assigned_to_ids_gin on sales_invoices using gin (assigned_to_ids);
create index if not exists proforma_invoices_assigned_to_ids_gin on proforma_invoices using gin (assigned_to_ids);
