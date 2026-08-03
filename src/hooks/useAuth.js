import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'

const OWNER_PERMISSIONS = { dashboard: true, sales: true, purchases: true, quotes: true, notes: true, arap: true, cashbank: true, ledger: true, import: true, permissions: true }
const DEFAULT_ACCOUNTANT_PERMISSIONS = { dashboard: true, sales: true, purchases: true, quotes: true, notes: true, arap: true, cashbank: true, ledger: false, import: false, permissions: false }

// Manages: the raw Supabase auth session, plus the firm_members row(s)
// that tell us which firm(s) this user belongs to and what role/permissions
// they have in each. A user can belong to more than one firm, which is why
// this returns a list rather than a single firm.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // True for the entire duration of signUpWithFirm's async work. The auth
  // state listener below sees the new session almost immediately after
  // auth.signUp() resolves - well before the firm/member rows this same
  // function goes on to create actually exist. Without this flag, App.jsx
  // has no way to distinguish "authenticated, firm creation still running"
  // from "authenticated, firm creation genuinely never happened" and shows
  // the no-firm dead-end for both. See signUpWithFirm below.
  const [provisioning, setProvisioning] = useState(false)

  // Guards a race: right after signup, the auth-state-change listener
  // fires a membership check immediately (before the firm even exists
  // yet), while signup's own explicit check happens after the firm is
  // created. Whichever of those two *resolves* last shouldn't always win -
  // only the one that was *started* last should. This counter enforces
  // that regardless of network timing.
  const requestIdRef = useRef(0)

  // If this user's email matches a pending invite (a firm_members row with
  // no user_id yet), link it to their real account now that they exist.
  // This has to go through link_pending_invites() (a SECURITY DEFINER RPC)
  // rather than a plain client query: firm_members' SELECT policy only
  // allows is_firm_member(firm_id), which is false for a row this user
  // isn't linked to *yet* - a catch-22 that would otherwise hide the very
  // row this check exists to find. Returns how many invites were claimed,
  // so callers (see signUpWithFirm below) can tell "this person just
  // joined an existing firm via invite" apart from "this person has no
  // invite, they're genuinely starting a new firm."
  const linkPendingInvites = useCallback(async (user) => {
    if (!user?.email) return 0
    const { data, error: rpcError } = await supabase.rpc('link_pending_invites')
    if (rpcError) return 0
    return data ?? 0
  }, [])

  const loadMemberships = useCallback(async (userId) => {
    const requestId = ++requestIdRef.current
    const { data, error: membershipError } = await supabase
      .from('firm_members')
      .select('id, firm_id, role, permissions, status, firms ( id, name, gstin, address, phone, email, logo_url, bank_details, invoice_prefix, next_invoice_number )')
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

  // Creates a brand new account, then one of two things: if this email
  // already has a pending invite waiting (someone invited them to an
  // existing firm), joins that firm instead - the firm name/GSTIN typed
  // into the form are ignored in that case, since there's already a firm
  // to join. Otherwise creates a brand new firm and makes them its Owner.
  // This auto-detection is what makes it safe for an invited teammate to
  // use this exact same "Create your firm" form without accidentally
  // spinning up a second, unwanted company - the previous version had no
  // such check and would always create a new firm regardless.
  const signUpWithFirm = useCallback(async ({ fullName, email, password, firmName, gstin }) => {
    setError(null)
    setProvisioning(true)

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) { setError(signUpError.message); setProvisioning(false); return { ok: false } }

    const user = signUpData.user
    const hasSession = !!signUpData.session
    if (!user || !hasSession) {
      // Email confirmation is required before a session exists - the account
      // was created, but we can't create the firm until they're actually
      // signed in for the first time (RLS needs a real auth.uid()).
      setError('Account created. If email confirmation is required on this project, check your email to confirm it, then sign in to finish setting up your firm.')
      setProvisioning(false)
      return { ok: false }
    }

    const joinedExistingFirm = (await linkPendingInvites(user)) > 0

    if (!joinedExistingFirm) {
      const { error: rpcError } = await supabase.rpc('create_firm_with_owner', {
        p_firm_name: firmName,
        p_full_name: fullName,
        p_gstin: gstin || null,
      })
      if (rpcError) { setError(rpcError.message); setProvisioning(false); return { ok: false } }
    }

    // This call is issued after the firm/membership rows exist, so the
    // request-id guard in loadMemberships ensures this result wins even if
    // the auth-listener's earlier (premature) check resolves later.
    await loadMemberships(user.id)
    setProvisioning(false)
    return { ok: true, joinedExistingFirm }
  }, [loadMemberships, linkPendingInvites])

  // Self-heal path for an account that's authenticated but has zero firm
  // memberships — e.g. a user created directly in the Supabase dashboard,
  // or one where the signup flow's auth step succeeded but the firm/member
  // inserts that follow it never ran. Unlike signUpWithFirm, there's no
  // auth.signUp call here: the session already exists, so this just
  // checks for a pending invite first (same reasoning as signUpWithFirm -
  // don't create a redundant new firm for someone who was actually invited
  // to an existing one), and only creates a new firm if none was found.
  const createFirmForSession = useCallback(async ({ fullName, firmName, gstin }) => {
    if (!session?.user) return { ok: false, error: 'No active session.' }
    const user = session.user

    const joinedExistingFirm = (await linkPendingInvites(user)) > 0
    if (!joinedExistingFirm) {
      const { error: rpcError } = await supabase.rpc('create_firm_with_owner', {
        p_firm_name: firmName,
        p_full_name: fullName,
        p_gstin: gstin || null,
      })
      if (rpcError) return { ok: false, error: rpcError.message }
    }

    await loadMemberships(user.id)
    return { ok: true }
  }, [session, loadMemberships, linkPendingInvites])

  // Owner (or anyone with the permissions.permissions right) invites a
  // teammate by email. Creates a pending row with no user_id yet - it gets
  // linked automatically the moment that person signs up or logs in with
  // this exact email (see linkPendingInvites above).
  // Lets a screen pull fresh firm_members/firms data after an edit that
  // happened outside the normal auth flow - e.g. renaming the firm, or
  // removing a teammate - without needing a full page reload.
  const refreshMemberships = useCallback(() => {
    if (session?.user) return loadMemberships(session.user.id)
  }, [session, loadMemberships])

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

  return { session, memberships, loading, provisioning, error, signIn, signUpWithFirm, createFirmForSession, inviteTeammate, refreshMemberships, signOut }
}
