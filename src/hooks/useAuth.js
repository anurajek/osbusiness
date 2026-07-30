import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

// Manages: the raw Supabase auth session, plus the firm_members row(s)
// that tell us which firm(s) this user belongs to and what role/permissions
// they have in each. A user can belong to more than one firm, which is why
// this returns a list rather than a single firm.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadMemberships = useCallback(async (userId) => {
    const { data, error: membershipError } = await supabase
      .from('firm_members')
      .select('id, firm_id, role, permissions, status, firms ( id, name, gstin )')
      .eq('user_id', userId)
      .eq('status', 'active')

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
        await loadMemberships(data.session.user.id)
      }
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return
      setSession(newSession)
      if (newSession?.user) {
        await loadMemberships(newSession.user.id)
      } else {
        setMemberships([])
      }
    })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [loadMemberships])

  const signIn = useCallback(async (email, password) => {
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
      return false
    }
    return true
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return { session, memberships, loading, error, signIn, signOut }
}
