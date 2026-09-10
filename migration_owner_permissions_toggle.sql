-- ============================================================================
-- Migration: Owner permission toggles actually take effect
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Until now, an Owner's module access was hardcoded to "everything on" in
-- the app itself (App.jsx's `allowed` check, AppShell's nav filter), and
-- Users & Permissions explicitly refused to toggle an Owner's own row -
-- the stored `permissions` JSONB on an Owner's firm_members row was never
-- actually consulted. Anuraj asked for the Owner row to be toggleable too,
-- same as any other member's.
--
-- The real risk in doing that: an Owner's permissions JSONB, as seeded by
-- create_firm_with_owner below, has never included every module (it's
-- missing `tasks` and `import` specifically, and the three hidden-from-nav
-- ones - quotes/notes/ledger - entirely). If the app started reading that
-- JSONB for real instead of hardcoding "everything on," every existing
-- Owner would suddenly lose access to Assigned Tasks and Import Data the
-- moment this shipped, through no action of their own. This migration
-- exists specifically to prevent that:
--
-- 1. Backfills every existing Owner's permissions to include every module
--    key as true - but ONLY the keys that are missing (jsonb_build_object
--    defaults, with the row's own existing permissions merged on top and
--    winning on any key already present). Nothing already-set is touched;
--    this only fills gaps, so an Owner who's explicit about a preference
--    keeps it, and nobody loses access they already had.
-- 2. Updates create_firm_with_owner so every *new* firm's Owner starts
--    with every module included from day one, not just the original five.
--
-- The app itself still adds one more safety net on top of this (see
-- App.jsx) - an Owner's own "permissions" module access is always forced
-- true regardless of what's stored, so there's no way to toggle yourself
-- out of the one screen that lets you fix a mistake.
-- ============================================================================

update firm_members
set permissions = jsonb_build_object(
  'dashboard', true, 'tasks', true, 'sales', true, 'purchases', true,
  'arap', true, 'cashbank', true, 'import', true, 'permissions', true,
  'quotes', true, 'notes', true, 'ledger', true
) || coalesce(permissions, '{}'::jsonb)
where role = 'Owner';

create or replace function create_firm_with_owner(
  p_firm_name text,
  p_full_name text,
  p_gstin text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_firm_id uuid;
begin
  if v_user_id is null then
    raise exception 'No authenticated user.';
  end if;

  insert into firms (name, gstin)
  values (p_firm_name, nullif(p_gstin, ''))
  returning id into v_firm_id;

  insert into firm_members (firm_id, user_id, full_name, role, permissions, status)
  values (
    v_firm_id,
    v_user_id,
    p_full_name,
    'Owner',
    '{"dashboard": true, "tasks": true, "sales": true, "purchases": true, "arap": true, "cashbank": true, "import": true, "permissions": true, "quotes": true, "notes": true, "ledger": true}'::jsonb,
    'active'
  );

  return v_firm_id;
end;
$$;

grant execute on function create_firm_with_owner(text, text, text) to authenticated;
