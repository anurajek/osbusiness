-- ============================================================================
-- Migration: Bank Transaction Links + Delete
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Two related problems this fixes:
--
-- 1. bank_transactions had no way back to "what created this" - just a
--    free-text description like "Payment received - INV-0007 (Acme Co)".
--    That meant there was no reliable way to reverse an invoice/bill's
--    paid_amount (or a credit/debit note's refunded status) when a
--    transaction created by "Record Payment"/"Record Refund" needed to be
--    deleted - the two would silently drift out of sync. These four
--    nullable link columns fix that: whichever one is set (at most one
--    ever will be) tells the delete handler exactly what to reverse.
--
-- 2. There was no DELETE policy on bank_transactions at all - "Record
--    Payment"/"Record Refund" could create a transaction, but nothing
--    could remove one, even a mistaken one. Unlike invoices/bills/journal
--    entries (which the app deliberately protects - see README), the cash
--    ledger is the one place a direct correction makes sense: if a payment
--    was logged wrong, the fix is deleting that entry (which reverses the
--    account balance and the linked invoice/bill/note automatically - see
--    CashBankScreen.jsx) and recording it again correctly, not leaving a
--    permanently wrong entry with no way to fix it.
-- ============================================================================

alter table bank_transactions add column if not exists related_sales_invoice_id uuid references sales_invoices(id) on delete set null;
alter table bank_transactions add column if not exists related_purchase_bill_id uuid references purchase_bills(id) on delete set null;
alter table bank_transactions add column if not exists related_credit_note_id uuid references credit_notes(id) on delete set null;
alter table bank_transactions add column if not exists related_debit_note_id uuid references debit_notes(id) on delete set null;

create policy "members can delete their firm's bank transactions" on bank_transactions
  for delete using (is_firm_member(firm_id));
