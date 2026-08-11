import { useState } from 'react'

export default function LoginScreen({ onSignIn, authError, onSwitchToSignup }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLocalError(null)

    if (!email.trim() || !password) {
      setLocalError('Enter both your email and password.')
      return
    }

    setSubmitting(true)
    await onSignIn(email.trim(), password)
    setSubmitting(false)
  }

  const errorToShow = localError || authError

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--ink)' }}>
      <div
        className="w-full max-w-sm rounded-[10px] p-8 text-left"
        style={{ background: 'var(--panel)', border: '1px solid var(--rule)' }}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
          style={{ background: 'var(--brass)', color: 'var(--ink)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h1 className="font-serif-display text-2xl font-semibold mb-1.5" style={{ color: 'var(--paper)' }}>
          FinoPilo Flow
        </h1>
        <p className="text-[12.5px] mb-3" style={{ color: 'var(--brass)', fontStyle: 'italic' }}>
          Your Financial Co-Pilot
        </p>
        <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--paper-dim)' }}>
          Sign in to your firm's books.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--panel-alt)', border: '1px solid var(--rule)', color: 'var(--paper)' }}
              placeholder="you@yourfirm.com"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--panel-alt)', border: '1px solid var(--rule)', color: 'var(--paper)' }}
              placeholder="••••••••"
            />
          </div>

          {errorToShow && (
            <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>
              {errorToShow}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ background: 'var(--brass)', color: 'var(--ink)' }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="login-footnote">
          New here?{' '}
          <button onClick={onSwitchToSignup} className="link-btn" style={{ padding: 0 }}>Create your firm</button>
        </p>
      </div>
    </div>
  )
}
