-- ============================================================================
-- Migration: Revoke is_firm_member's anon access (authenticated untouched)
-- Run this in Supabase's SQL Editor.
--
-- Handled separately from migration_lock_security_definer_functions.sql on
-- purpose: is_firm_member is the one function in this whole list I don't
-- have the source for (it predates this project's migration history - set
-- up directly in Supabase before the migration-file workflow started), and
-- it's called by every single RLS policy in the app. Revoking too much
-- here would break row-level security everywhere, all at once, for every
-- user - so this ONLY revokes the anon (unauthenticated) grant. The
-- `authenticated` role's access is never touched by this migration.
--
-- Reasoning without seeing the source: is_firm_member(firm_id) is used
-- identically everywhere - a read-only boolean check with no visible side
-- effects, always evaluating "is the *currently authenticated* user a
-- member of this firm." An anon caller has no authenticated identity to
-- check membership for, and no unauthenticated feature in this app queries
-- firm data at all - so closing anon's access should be safe. Test this
-- one specifically after running it: log in, load the Dashboard, open a
-- couple of other screens. If anything comes back empty or throws a
-- permissions error that wasn't there before, run the ROLLBACK line at the
-- bottom immediately and let me know what broke.
-- ============================================================================

revoke execute on function is_firm_member(uuid) from public;
grant execute on function is_firm_member(uuid) to authenticated;

-- ROLLBACK (only if something breaks after running the above):
-- grant execute on function is_firm_member(uuid) to public;
