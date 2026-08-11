import { useState } from 'react'

export default function ResetPasswordScreen({ onCompleteReset }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password.length < 6) { setError('Use at least 6 characters.'); return }
    if (password !== confirmPassword) { setError("Those two passwords don't match."); return }

    setSubmitting(true)
    const result = await onCompleteReset(password)
    setSubmitting(false)
    if (!result.ok) { setError(result.error); return }
    setDone(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--ink)' }}>
      <div className="w-full max-w-sm rounded-[10px] p-8 text-left" style={{ background: 'var(--panel)', border: '1px solid var(--rule)' }}>
        <h1 className="font-serif-display text-2xl font-semibold mb-1.5" style={{ color: 'var(--paper)' }}>
          Set a new password
        </h1>

        {done ? (
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--paper-dim)' }}>
            Your password has been updated. You're signed in — refresh the page if it doesn't move on automatically.
          </p>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--paper-dim)' }}>
              Choose a new password for your account.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>
                  New password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--panel-alt)', border: '1px solid var(--rule)', color: 'var(--paper)' }}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>
                  Confirm new password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--panel-alt)', border: '1px solid var(--rule)', color: 'var(--paper)' }}
                  placeholder="••••••••"
                />
              </div>

              {error && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="mt-1 rounded-lg py-2.5 text-sm font-semibold disabled:opacity-60"
                style={{ background: 'var(--brass)', color: 'var(--ink)' }}
              >
                {submitting ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
