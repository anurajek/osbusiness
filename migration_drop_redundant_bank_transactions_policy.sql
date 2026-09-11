-- ============================================================================
-- Migration: Drop the redundant DELETE policy on bank_transactions
-- Run this in Supabase's SQL Editor. Safe - confirmed via pg_policies.
--
-- Same exact situation as ar_comms: "members can delete their firm's bank
-- transactions" (DELETE, is_firm_member(firm_id)) is 100% redundant with
-- the existing "members can access their firm's bank transactions" (ALL,
-- same condition) - identical qual, no extra restriction, so it's pure
-- duplicate evaluation on every query with zero functional difference.
-- Unlike the customers/purchase_bills/sales_invoices/suppliers "imported"
-- delete policies (handled separately - see chat), this one has no
-- import_batch_id condition narrowing it, so there's no open question
-- here - just redundant, safe to remove outright.
-- ============================================================================

drop policy if exists "members can delete their firm's bank transactions" on bank_transactions;
