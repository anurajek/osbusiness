-- ============================================================================
-- Migration: Add "Partially Paid" to the manual status vocabulary
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- "Cancelled" is deliberately NOT added here - it already has a real,
-- correct mechanism (is_cancelled, from migration_cancel_invoices_pi.sql),
-- and adding it as a second, separate manual_status value would create two
-- different ways to represent the same thing that could drift out of sync
-- with each other. The app's "Cancelled" option in the status dropdowns is
-- wired to toggle is_cancelled directly, not to write this text field.
-- ============================================================================

alter table sales_invoices drop constraint if exists sales_invoices_manual_status_check;
alter table sales_invoices add constraint sales_invoices_manual_status_check
  check (manual_status is null or manual_status in ('Sent', 'Overdue', 'Partially Paid', 'Paid', 'Invoiced', 'Completed'));

alter table proforma_invoices drop constraint if exists proforma_invoices_manual_status_check;
alter table proforma_invoices add constraint proforma_invoices_manual_status_check
  check (manual_status is null or manual_status in ('Sent', 'Overdue', 'Partially Paid', 'Paid', 'Invoiced', 'Completed'));
