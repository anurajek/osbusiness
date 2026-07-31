-- ============================================================================
-- Migration: create_firm_with_owner() RPC
-- Run this in Supabase's SQL Editor. Safe to run on the existing database.
--
-- Why this exists: the client used to do `insert into firms(...).select().single()`
-- directly. That chains an INSERT with a RETURNING clause, and Postgres checks
-- the *returned* row against the table's SELECT policy (is_firm_member(id)) -
-- not just the INSERT policy. A brand-new firm has no membership row yet, so
-- that SELECT check always failed, and the whole insert got rolled back with
-- "new row violates row-level security policy for table firms" - even though
-- the INSERT policy itself (any authenticated user can create a firm) was
-- perfectly correct. Doing both inserts inside one SECURITY DEFINER function
-- sidesteps this entirely (the function body isn't subject to RLS), and as a
-- bonus makes firm+membership creation atomic - no more risk of a firm row
-- existing with no owner if the second insert ever failed.
-- ============================================================================

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
    '{"dashboard": true, "sales": true, "purchases": true, "arap": true, "cashbank": true, "permissions": true}'::jsonb,
    'active'
  );

  return v_firm_id;
end;
$$;

grant execute on function create_firm_with_owner(text, text, text) to authenticated;
