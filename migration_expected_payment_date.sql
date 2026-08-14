-- ============================================================================
-- Migration: Expected Date column for Invoice/PI Follow-up
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Replaces the "Last Reminder" column on Invoice/PI Follow-up with a
-- manually-set "Expected Date" - for recording when a customer/supplier
-- actually said they'd pay (e.g. from a phone call), separate from the
-- calculated due date. Always optional/nullable - there's no requirement
-- to set one, and it can be changed or cleared at any time.
-- ============================================================================

alter table sales_invoices add column if not exists expected_payment_date date;
alter table proforma_invoices add column if not exists expected_payment_date date;
