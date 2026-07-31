import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'

const OWNER_PERMISSIONS = { dashboard: true, sales: true, purchases: true, arap: true, cashbank: true, permissions: true }
const DEFAULT_ACCOUNTANT_PERMISSIONS = { dashboard: true, sales: true, purchases: true, arap: true, cashbank: true, permissions: false }

// Manages: the raw Supabase auth session, plus the firm_members row(s)
// that tell us which firm(s) this user belongs to and what role/permissions
// they have in each. A user can belong to more than one firm, which is why
// this returns a list rather than a single firm.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Guards a race: right after signup, the auth-state-change listener
  // fires a membership check immediately (before the firm even exists
  // yet), while signup's own explicit check happens after the firm is
  // created. Whichever of those two *resolves* last shouldn't always win -
  // only the one that was *started* last should. This counter enforces
  // that regardless of network timing.
  const requestIdRef = useRef(0)

  // If this user's email matches a pending invite (a firm_members row with
  // no user_id yet), link it to their real account now that they exist.
  const linkPendingInvites = useCallback(async (user) => {
    if (!user?.email) return
    const { data: pending } = await supabase
      .from('firm_members')
      .select('id')
      .is('user_id', null)
      .eq('invited_email', user.email)
      .eq('status', 'invited')

    if (pending && pending.length > 0) {
      await supabase
        .from('firm_members')
        .update({ user_id: user.id, status: 'active' })
        .in('id', pending.map((p) => p.id))
    }
  }, [])

  const loadMemberships = useCallback(async (userId) => {
    const requestId = ++requestIdRef.current
    const { data, error: membershipError } = await supabase
      .from('firm_members')
      .select('id, firm_id, role, permissions, status, firms ( id, name, gstin )')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (requestId !== requestIdRef.current) return // a newer request superseded this one

    if (membershipError) {
      setError(membershipError.message)
      setMemberships([])
      return
    }
    setMemberships(data ?? [])
  }, [])

  useEffect(() => {
    let isMounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return
      setSession(data.session)
      if (data.session?.user) {
        await linkPendingInvites(data.session.user)
        await loadMemberships(data.session.user.id)
      }
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return
      setSession(newSession)
      if (newSession?.user) {
        await linkPendingInvites(newSession.user)
        await loadMemberships(newSession.user.id)
      } else {
        setMemberships([])
      }
    })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [loadMemberships, linkPendingInvites])

  const signIn = useCallback(async (email, password) => {
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
      return false
    }
    return true
  }, [])

  // Creates a brand new account AND a brand new firm in one step, and makes
  // the new user its Owner. This is the self-service "sign up" path.
  const signUpWithFirm = useCallback(async ({ fullName, email, password, firmName, gstin }) => {
    setError(null)

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) { setError(signUpError.message); return false }

    const user = signUpData.user
    const hasSession = !!signUpData.session
    if (!user || !hasSession) {
      // Email confirmation is required before a session exists - the account
      // was created, but we can't create the firm until they're actually
      // signed in for the first time (RLS needs a real auth.uid()).
      setError('Account created. If email confirmation is required on this project, check your email to confirm it, then sign in to finish setting up your firm.')
      return false
    }

    const { data: firm, error: firmError } = await supabase
      .from('firms')
      .insert({ name: firmName, gstin: gstin || null })
      .select('id')
      .single()
    if (firmError) { setError(firmError.message); return false }

    const { error: memberError } = await supabase.from('firm_members').insert({
      firm_id: firm.id,
      user_id: user.id,
      full_name: fullName,
      role: 'Owner',
      permissions: OWNER_PERMISSIONS,
      status: 'active',
    })
    if (memberError) { setError(memberError.message); return false }

    // This call is issued after the firm/membership rows exist, so the
    // request-id guard in loadMemberships ensures this result wins even if
    // the auth-listener's earlier (premature) check resolves later.
    await loadMemberships(user.id)
    return true
  }, [loadMemberships])

  // Owner (or anyone with the permissions.permissions right) invites a
  // teammate by email. Creates a pending row with no user_id yet - it gets
  // linked automatically the moment that person signs up or logs in with
  // this exact email (see linkPendingInvites above).
  const inviteTeammate = useCallback(async ({ firmId, email, fullName, role }) => {
    const permissions = role === 'Owner' ? OWNER_PERMISSIONS : DEFAULT_ACCOUNTANT_PERMISSIONS
    const { error: inviteError } = await supabase.from('firm_members').insert({
      firm_id: firmId,
      invited_email: email,
      full_name: fullName,
      role,
      permissions,
      status: 'invited',
    })
    return inviteError ? inviteError.message : null
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return { session, memberships, loading, error, signIn, signUpWithFirm, inviteTeammate, signOut }
}
