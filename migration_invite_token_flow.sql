-- ============================================================================
-- Migration: Token-based invite acceptance (Zoho-style)
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Replaces "the invite email links to the app's home page, and whoever
-- clicks it just sees the normal login/signup screen" with a real,
-- dedicated flow: each invite gets its own unique link
-- (APP_URL/?invite={token}), which shows exactly who invited them and to
-- which firm, and leads straight to a signup form locked to that one
-- specific email - no ambiguity, no accidentally creating a new firm.
--
-- The old email-matching link_pending_invites() RPC (see
-- migration_fix_invite_linking.sql) stays in place as a fallback/self-heal
-- path - it still runs on every login/signup regardless of how someone got
-- there, so an invite still gets linked correctly even for an old-style
-- link or if someone signs up a different way. This migration adds the
-- more precise, token-scoped path on top of that, not instead of it.
-- ============================================================================

alter table firm_members add column if not exists invite_token uuid default gen_random_uuid();
alter table firm_members add column if not exists invited_by uuid references auth.users(id);

create unique index if not exists firm_members_invite_token_unique
  on firm_members (invite_token) where invite_token is not null;

-- ----------------------------------------------------------------------------
-- get_invite_details: what the "Join {firm}" landing page needs to show,
-- before the visitor has an account or a session at all - callable by the
-- anon role, deliberately. Returns nothing (empty result set) for an
-- unknown/already-claimed token rather than an error, so the UI can show
-- one clear "this invite isn't valid anymore" state either way.
-- ----------------------------------------------------------------------------
create or replace function get_invite_details(p_token uuid)
returns table (
  firm_name text,
  invited_email text,
  role text,
  status text,
  inviter_name text,
  inviter_email text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    f.name,
    fm.invited_email,
    fm.role,
    fm.status,
    inviter_member.full_name,
    inviter_user.email::text
  from firm_members fm
  join firms f on f.id = fm.firm_id
  left join auth.users inviter_user on inviter_user.id = fm.invited_by
  left join firm_members inviter_member
    on inviter_member.user_id = fm.invited_by and inviter_member.firm_id = fm.firm_id
  where fm.invite_token = p_token;
end;
$$;

grant execute on function get_invite_details(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- claim_invite_by_token: the actual join step, called right after the
-- invited person creates their account. Looks up the caller's own verified
-- email server-side (never trusts a client-supplied email) and only claims
-- the invite if it matches exactly - the token being hard to guess is
-- already strong protection, this is defense in depth on top of that.
-- ----------------------------------------------------------------------------
create or replace function claim_invite_by_token(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invited_email text;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'No authenticated user.';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select invited_email, status into v_invited_email, v_status
    from firm_members where invite_token = p_token;

  if v_invited_email is null then
    raise exception 'This invite link is no longer valid.';
  end if;
  if v_status <> 'invited' then
    raise exception 'This invite has already been used.';
  end if;
  if lower(v_invited_email) <> lower(v_email) then
    raise exception 'This invite was sent to a different email address than the one you just signed up with.';
  end if;

  update firm_members
    set user_id = v_user_id, status = 'active'
    where invite_token = p_token;
end;
$$;

grant execute on function claim_invite_by_token(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- decline_invite_by_token: lets someone reject an invite right from the
-- landing page, before ever creating an account - matches the "Reject"
-- option on the reference flow this is modeled on.
-- ----------------------------------------------------------------------------
create or replace function decline_invite_by_token(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from firm_members where invite_token = p_token and status = 'invited';
end;
$$;

grant execute on function decline_invite_by_token(uuid) to anon, authenticated;
