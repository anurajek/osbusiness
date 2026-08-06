-- ============================================================================
-- Migration: Itemized tax breakdown + manual workflow status
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Two independent additions, both optional/nullable so every existing
-- imported record stays exactly as valid as it was before this migration:
--
-- 1. Item/tax fields on Sales Invoices, Purchase Bills, and Proforma
--    Invoices - description, quantity, rate, subtotal, discount, and
--    CGST/SGST/IGST rate+amount. This is deliberately ONE line item per
--    document (matching the CSV-import model, one row = one document),
--    not a full itemized multi-line-item table like Quotations has - a
--    single line item with a real tax breakdown was the actual thing
--    shown in the reference screenshot, and it's what a CSV export from
--    Zoho/Tally's "summary" bill data can realistically carry without
--    needing multi-row-per-document import parsing. When these columns
--    are null (existing records, or any import that doesn't map them),
--    the PDF falls back to the plain single-total summary exactly as
--    before - nothing is required to keep using the app as-is.
--
-- 2. A manual, user-set workflow status on Sales Invoices and Proforma
--    Invoices - Sent / Overdue / Paid / Invoiced / Completed. This is
--    independent of (does not replace) the automatic payment-based
--    pending/overdue calculation already used everywhere else - it's a
--    convenience marker for things this tool has no way to detect on its
--    own, most importantly "Invoiced" (this PI has now been converted to
--    a real Tax Invoice over in the accounting software).
-- ============================================================================

alter table sales_invoices add column if not exists item_description text;
alter table sales_invoices add column if not exists item_quantity numeric(12, 2);
alter table sales_invoices add column if not exists item_rate numeric(14, 2);
alter table sales_invoices add column if not exists subtotal numeric(14, 2);
alter table sales_invoices add column if not exists discount_amount numeric(14, 2);
alter table sales_invoices add column if not exists cgst_rate numeric(5, 2);
alter table sales_invoices add column if not exists cgst_amount numeric(14, 2);
alter table sales_invoices add column if not exists sgst_rate numeric(5, 2);
alter table sales_invoices add column if not exists sgst_amount numeric(14, 2);
alter table sales_invoices add column if not exists igst_rate numeric(5, 2);
alter table sales_invoices add column if not exists igst_amount numeric(14, 2);

alter table purchase_bills add column if not exists item_description text;
alter table purchase_bills add column if not exists item_quantity numeric(12, 2);
alter table purchase_bills add column if not exists item_rate numeric(14, 2);
alter table purchase_bills add column if not exists subtotal numeric(14, 2);
alter table purchase_bills add column if not exists discount_amount numeric(14, 2);
alter table purchase_bills add column if not exists cgst_rate numeric(5, 2);
alter table purchase_bills add column if not exists cgst_amount numeric(14, 2);
alter table purchase_bills add column if not exists sgst_rate numeric(5, 2);
alter table purchase_bills add column if not exists sgst_amount numeric(14, 2);
alter table purchase_bills add column if not exists igst_rate numeric(5, 2);
alter table purchase_bills add column if not exists igst_amount numeric(14, 2);

alter table proforma_invoices add column if not exists item_description text;
alter table proforma_invoices add column if not exists item_quantity numeric(12, 2);
alter table proforma_invoices add column if not exists item_rate numeric(14, 2);
alter table proforma_invoices add column if not exists subtotal numeric(14, 2);
alter table proforma_invoices add column if not exists discount_amount numeric(14, 2);
alter table proforma_invoices add column if not exists cgst_rate numeric(5, 2);
alter table proforma_invoices add column if not exists cgst_amount numeric(14, 2);
alter table proforma_invoices add column if not exists sgst_rate numeric(5, 2);
alter table proforma_invoices add column if not exists sgst_amount numeric(14, 2);
alter table proforma_invoices add column if not exists igst_rate numeric(5, 2);
alter table proforma_invoices add column if not exists igst_amount numeric(14, 2);

alter table sales_invoices add column if not exists manual_status text
  check (manual_status is null or manual_status in ('Sent', 'Overdue', 'Paid', 'Invoiced', 'Completed'));
alter table proforma_invoices add column if not exists manual_status text
  check (manual_status is null or manual_status in ('Sent', 'Overdue', 'Paid', 'Invoiced', 'Completed'));
