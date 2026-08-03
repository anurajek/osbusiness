-- ============================================================================
-- Migration: Fix invite-linking's RLS catch-22 + auto-join on signup
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- The bug: firm_members' SELECT policy only allows is_firm_member(firm_id) -
-- meaning a user isn't allowed to see their own pending invite row (which
-- has no user_id yet) until *after* they're linked to it, which is exactly
-- the thing the client-side linking check was trying to determine. That
-- check has therefore likely never actually been able to see a pending
-- invite via the plain client query, regardless of which screen someone
-- signed up from.
--
-- The fix: a SECURITY DEFINER function that looks up "my own auth email"
-- server-side (not something the caller can spoof by passing a different
-- email) and claims only invite rows that exactly match it. This sidesteps
-- RLS entirely for this one narrow, safe operation - the same pattern
-- already used for create_firm_with_owner()/create_journal_entry() earlier
-- in this project for the same class of bootstrap problem.
-- ============================================================================

create or replace function link_pending_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_count int;
begin
  if v_user_id is null then
    raise exception 'No authenticated user.';
  end if;

  select email into v_email from auth.users where id = v_user_id;
  if v_email is null then
    return 0;
  end if;

  with claimed as (
    update firm_members
    set user_id = v_user_id, status = 'active'
    where invited_email = v_email and user_id is null and status = 'invited'
    returning id
  )
  select count(*) into v_count from claimed;

  return v_count;
end;
$$;

grant execute on function link_pending_invites() to authenticated;
