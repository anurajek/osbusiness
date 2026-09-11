-- ============================================================================
-- Migration: Fix auth_rls_initplan on firms and firm_members
-- Run this in Supabase's SQL Editor. Safe - purely a performance rewrite,
-- same logical result as before, confirmed against the real with_check
-- clauses first (see chat) rather than guessed.
--
-- Postgres re-evaluates a bare auth.uid() call once per row a policy is
-- checked against; wrapping it as (select auth.uid()) lets Postgres
-- evaluate it once per query instead (an "InitPlan"), then reuse that
-- result for every row. Same outcome, meaningfully less work at scale.
-- This is Supabase's own documented fix for this exact lint.
--
-- ALTER POLICY ... WITH CHECK (...) only touches the WITH CHECK clause
-- being set here - it doesn't need (and won't change) whichever roles
-- each policy already applies to.
-- ============================================================================

alter policy "any authenticated user can create a firm" on firms
  with check ((select auth.uid()) is not null);

alter policy "insert own membership or invite a teammate" on firm_members
  with check (user_id = (select auth.uid()) or is_firm_member(firm_id));
