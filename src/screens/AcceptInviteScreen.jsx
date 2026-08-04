import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function AcceptInviteScreen({ token, session, onAccept, onSignOut, provisioning }) {
  const [details, setDetails] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [declining, setDeclining] = useState(false)

  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_invite_details', { p_token: token }).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data || data.length === 0) { setNotFound(true); setLoadingDetails(false); return }
      setDetails(data[0])
      setLoadingDetails(false)
    })
    return () => { cancelled = true }
  }, [token])

  const handleAccept = async (e) => {
    e.preventDefault()
    setFormError(null)
    if (!password || password.length < 6) {
      setFormError('Password should be at least 6 characters.')
      return
    }
    setSubmitting(true)
    const result = await onAccept({ token, email: details.invited_email, password })
    if (!result.ok) {
      setSubmitting(false)
      setFormError(result.error || 'Something went wrong - please try again.')
      return
    }
    // Success - without clearing ?invite= from the URL, the app would keep
    // showing this same screen forever (App.jsx checks for that param
    // before anything else), even though the account and membership are
    // now both fully set up. This drops it and lands in the app normally.
    window.location.href = window.location.origin + window.location.pathname
  }

  // Already signed in with the exact invited email (e.g. re-opening their
  // own invite link, or they'd already logged in some other way) - no
  // password needed, just claim the invite directly.
  const handleJoinAsCurrentUser = async () => {
    setSubmitting(true)
    setFormError(null)
    const { error } = await supabase.rpc('claim_invite_by_token', { p_token: token })
    setSubmitting(false)
    if (error) { setFormError(error.message); return }
    window.location.href = window.location.origin + window.location.pathname
  }

  const handleDecline = async () => {
    if (!window.confirm(`Decline this invite to ${details?.firm_name}?`)) return
    setDeclining(true)
    await supabase.rpc('decline_invite_by_token', { p_token: token })
    setDeclining(false)
    setDeclined(true)
  }

  return (
    <div className="login-shell" style={{ background: 'var(--ink)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, padding: 32, textAlign: 'left' }}>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
          style={{ background: 'var(--brass)', color: 'var(--ink)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {loadingDetails && <p style={{ color: 'var(--paper-dim)' }}>Loading invite…</p>}

        {!loadingDetails && notFound && (
          <>
            <h1 className="font-serif-display text-xl font-semibold mb-2" style={{ color: 'var(--paper)' }}>Invite not found</h1>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--paper-dim)' }}>
              This invite link isn't valid — it may have been removed, or the link was typo'd. Ask whoever invited you to send a new one.
            </p>
          </>
        )}

        {!loadingDetails && !notFound && declined && (
          <>
            <h1 className="font-serif-display text-xl font-semibold mb-2" style={{ color: 'var(--paper)' }}>Invite declined</h1>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--paper-dim)' }}>
              You've declined this invite. Nothing else to do — you can close this tab.
            </p>
          </>
        )}

        {!loadingDetails && !notFound && !declined && details.status !== 'invited' && (
          <>
            <h1 className="font-serif-display text-xl font-semibold mb-2" style={{ color: 'var(--paper)' }}>Already used</h1>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--paper-dim)' }}>
              This invite has already been accepted. If that wasn't you, ask an Owner at {details.firm_name} to send you a fresh one.
            </p>
          </>
        )}

        {!loadingDetails && !notFound && !declined && details.status === 'invited' && (
          <>
            <h1 className="font-serif-display text-xl font-semibold mb-1" style={{ color: 'var(--paper)' }}>
              {details.firm_name}
            </h1>
            <p className="login-footnote" style={{ marginTop: 0, marginBottom: 20 }}>
              Invited by {details.inviter_name ? `${details.inviter_name} (${details.inviter_email})` : details.inviter_email || 'a firm Owner'}
            </p>

            {session && session.user.email.toLowerCase() !== details.invited_email.toLowerCase() ? (
              <>
                <p className="text-[13px] leading-relaxed mb-4" style={{ color: 'var(--paper-dim)' }}>
                  You're currently signed in as <strong>{session.user.email}</strong>, but this invite was sent to{' '}
                  <strong>{details.invited_email}</strong>. Sign out first, then reopen this link to accept it with the right account.
                </p>
                <button className="btn-primary" style={{ width: '100%', textAlign: 'center', padding: '10px 0' }} onClick={onSignOut}>
                  Sign out
                </button>
              </>
            ) : session ? (
              <>
                <p className="text-[13px] leading-relaxed mb-4" style={{ color: 'var(--paper-dim)' }}>
                  You're already signed in as {session.user.email} — join as <strong>{details.role}</strong>?
                </p>
                {formError && <p className="text-[12.5px] mb-3" style={{ color: 'var(--brick)' }}>{formError}</p>}
                <button className="btn-primary" disabled={submitting} style={{ width: '100%', textAlign: 'center', padding: '10px 0' }} onClick={handleJoinAsCurrentUser}>
                  {submitting ? 'Joining…' : `Join ${details.firm_name}`}
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--paper-dim)' }}>
                  Create a password for <strong>{details.invited_email}</strong> to join as <strong>{details.role}</strong>.
                </p>
                <form onSubmit={handleAccept} className="flex flex-col gap-4">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>Password</label>
                    <input
                      type="password" className="text-input" value={password}
                      onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoFocus
                    />
                  </div>
                  {formError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{formError}</p>}
                  <button type="submit" disabled={submitting || provisioning} className="btn-primary" style={{ width: '100%', textAlign: 'center', padding: '10px 0' }}>
                    {submitting || provisioning ? 'Joining…' : 'Accept & create account'}
                  </button>
                </form>
                <p className="login-footnote">
                  Not expecting this?{' '}
                  <button onClick={handleDecline} disabled={declining} className="link-btn" style={{ padding: 0, color: 'var(--brick)' }}>
                    {declining ? 'Declining…' : 'Decline invite'}
                  </button>
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
