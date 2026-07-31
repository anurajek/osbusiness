-- ============================================================================
-- Migration: enable self-service signup + team invites
-- Run this in Supabase SQL Editor. Safe to run on your existing database -
-- it only adds/changes what's needed, doesn't touch existing data.
-- ============================================================================

-- 1. Allow a pending invite to exist before the invited person has an account
alter table firm_members alter column user_id drop not null;
alter table firm_members add column if not exists invited_email text;

-- A firm can't have two active/pending rows for the same email
create unique index if not exists firm_members_firm_email_unique
  on firm_members (firm_id, coalesce(invited_email, ''));

-- 2. Fix the chicken-and-egg problem: creating a brand new firm means you
-- aren't a member of it yet, so the old "is_firm_member" check would block
-- you from ever creating the first firm. Split INSERT out from the rest.

drop policy if exists "members can access their firm" on firms;

create policy "any authenticated user can create a firm" on firms
  for insert
  with check (auth.uid() is not null);

create policy "members can view/update/delete their firm" on firms
  for select using (is_firm_member(id));
create policy "members can update their firm" on firms
  for update using (is_firm_member(id));
create policy "members can delete their firm" on firms
  for delete using (is_firm_member(id));

-- 3. Same fix for firm_members: you can always insert a row for yourself
-- (signing up as Owner of your own new firm), and an existing member can
-- insert a row for someone else (inviting a teammate).

drop policy if exists "members can see their own firm's membership rows" on firm_members;

create policy "insert own membership or invite a teammate" on firm_members
  for insert
  with check (user_id = auth.uid() OR is_firm_member(firm_id));

create policy "members can view their firm's membership rows" on firm_members
  for select using (is_firm_member(firm_id));
create policy "members can update their firm's membership rows" on firm_members
  for update using (is_firm_member(firm_id));
create policy "members can delete their firm's membership rows" on firm_members
  for delete using (is_firm_member(firm_id));
