-- ============================================================================
-- Migration: Real payment recording from status changes + PI-to-Invoice link
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Two things, needed together:
--
-- 1. bank_transactions.related_proforma_invoice_id - mirrors the existing
--    related_sales_invoice_id/related_purchase_bill_id columns. Needed so
--    that marking a PI "Paid" (or "Partially Paid") through the real
--    Record Payment flow can create a genuine, linkable transaction for
--    it, the same way Sales/Purchases already could - without this, a
--    PI's payment had nowhere real to attach to.
--
-- 2. sales_invoices.linked_pi_id - a new, explicit "this invoice is the
--    real Tax Invoice that this Proforma Invoice became" link, created
--    manually (Sales -> Actions -> Link to PI) once the real invoice has
--    been imported from the accounting software. Linking automatically
--    carries the PI's payment over to the invoice and re-points its bank
--    transaction to the invoice - not a duplicate transaction, the same
--    one, since the cash was only ever received once.
-- ============================================================================

alter table bank_transactions add column if not exists related_proforma_invoice_id uuid references proforma_invoices(id) on delete set null;

alter table sales_invoices add column if not exists linked_pi_id uuid references proforma_invoices(id) on delete set null;
