-- ============================================================================
-- Migration: Cancel option for Sales Invoices + Proforma Invoices
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- is_cancelled already existed on purchase_bills (see
-- migration_bill_cancel_and_supplier_comms.sql) - this extends the exact
-- same pattern to sales_invoices and proforma_invoices, since "cancelled"
-- is just as real a state for something you issued as for something you
-- received.
-- ============================================================================

alter table sales_invoices add column if not exists is_cancelled boolean not null default false;
alter table proforma_invoices add column if not exists is_cancelled boolean not null default false;
