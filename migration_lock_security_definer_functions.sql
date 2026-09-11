-- ============================================================================
-- Migration: Revoke the default PUBLIC execute grant on functions that
-- require authentication
-- Run this in Supabase's SQL Editor. Each function's internal checks were
-- verified against its actual body before being included here (see the
-- README/chat for the full walkthrough) - none of these are guesses.
--
-- Root cause, not just symptom: every migration that created these
-- functions added "grant execute ... to authenticated", but none of them
-- ever added "revoke execute ... from public" first. Postgres grants
-- EXECUTE to PUBLIC automatically when a function is created unless it's
-- explicitly revoked - so the `authenticated` grant was always additive on
-- top of unauthenticated (anon) access nobody ever intentionally gave out.
-- That's what Security Advisor's "Public Can Execute SECURITY DEFINER
-- Function" warning is actually catching here.
--
-- Every function below was confirmed to check auth.uid() and/or
-- is_firm_member(p_firm_id) internally before doing anything - an anon
-- caller gets "No authenticated user." or "Not a member of this firm."
-- immediately either way, so this migration is about correctness (closing
-- a gap nobody meant to leave open) more than fixing an active
-- exploit - but there's no reason a document-numbering function or a
-- journal-entry function should be reachable by a fully anonymous caller
-- at all, so this fully closes it at the grant level instead of relying
-- on the function's own runtime check.
--
-- NOT included here on purpose: get_invite_details and
-- decline_invite_by_token, both explicitly granted to anon *and*
-- authenticated back in migration_invite_token_flow.sql, and neither
-- checks auth.uid() internally - that's intentional design (the invite
-- token itself is the credential, for the pre-login "you've been invited"
-- page and the ability to decline without being forced to create an
-- account first), not an oversight. Also not included: is_firm_member,
-- handled separately - see migration_search_path_fix.sql's sibling
-- discussion in chat for why that one needs a slower, more careful pass.
-- ============================================================================

revoke execute on function create_journal_entry(uuid, date, text, jsonb) from public;
grant execute on function create_journal_entry(uuid, date, text, jsonb) to authenticated;

revoke execute on function post_journal_entry(uuid) from public;
grant execute on function post_journal_entry(uuid) to authenticated;

revoke execute on function create_firm_with_owner(text, text, text) from public;
grant execute on function create_firm_with_owner(text, text, text) to authenticated;

revoke execute on function claim_invite_by_token(uuid) from public;
grant execute on function claim_invite_by_token(uuid) to authenticated;

revoke execute on function next_sales_invoice_number(uuid) from public;
grant execute on function next_sales_invoice_number(uuid) to authenticated;

revoke execute on function next_pi_number(uuid) from public;
grant execute on function next_pi_number(uuid) to authenticated;

revoke execute on function next_quote_number(uuid) from public;
grant execute on function next_quote_number(uuid) to authenticated;

revoke execute on function next_credit_note_number(uuid) from public;
grant execute on function next_credit_note_number(uuid) to authenticated;

revoke execute on function next_debit_note_number(uuid) from public;
grant execute on function next_debit_note_number(uuid) to authenticated;
