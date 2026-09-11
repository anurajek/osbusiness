-- ============================================================================
-- Migration: Pin search_path on every function in this project
-- Run this in Supabase's SQL Editor. Additive/safe - doesn't touch any
-- function's actual logic, only a configuration setting on it.
--
-- What this fixes: Supabase's Security Advisor flags any function with no
-- explicit search_path as "Function Search Path Mutable" - without it, a
-- function (especially a SECURITY DEFINER one, which several of these are)
-- is theoretically exploitable via a "search path hijack": someone with
-- create privileges on a schema earlier in the resolution order could
-- define an object with the same name as one the function references, and
-- the function would silently resolve to the attacker's version instead of
-- the real one. Pinning search_path to exactly `public` closes that off.
--
-- Why ALTER FUNCTION rather than rewriting each one with CREATE OR REPLACE:
-- this changes a configuration setting on the function, not its body -
-- zero risk of a transcription mistake breaking actual logic, and it works
-- without needing to know each function's exact argument signature up
-- front (the DO block below looks each one up by name in pg_proc and
-- builds the correct call itself, handling overloads like
-- create_firm_with_owner automatically - there were several versions
-- created across earlier migrations, each superseding the last via
-- "create or replace", but this fixes whichever one is actually live).
--
-- Scoped to the functions this project actually created - is_firm_member
-- (the RLS helper every table's policies call), create_firm_with_owner,
-- the document-numbering functions (next_sales_invoice_number,
-- next_pi_number, next_quote_number, next_credit_note_number,
-- next_debit_note_number), the invite flow (link_pending_invites,
-- get_invite_details, claim_invite_by_token, decline_invite_by_token),
-- and the journal entry functions (create_journal_entry,
-- post_journal_entry). Does NOT touch forecast_for_category or
-- forecasts_for_month, which the Security Advisor also flagged - those
-- aren't anything this project defines, so they're left alone until
-- that's confirmed one way or the other.
-- ============================================================================

do $$
declare
  fn_name text;
  fn_names text[] := array[
    'is_firm_member',
    'create_firm_with_owner',
    'next_sales_invoice_number',
    'next_pi_number',
    'next_quote_number',
    'next_credit_note_number',
    'next_debit_note_number',
    'link_pending_invites',
    'get_invite_details',
    'claim_invite_by_token',
    'decline_invite_by_token',
    'create_journal_entry',
    'post_journal_entry'
  ];
  r record;
begin
  foreach fn_name in array fn_names loop
    for r in
      select p.oid::regprocedure as func_sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn_name
    loop
      execute format('alter function %s set search_path = public', r.func_sig);
    end loop;
  end loop;
end $$;
