import { useState } from 'react'

export default function SignupScreen({ onSignUp, authError, onSwitchToLogin }) {
  const [fullName, setFullName] = useState('')
  const [firmName, setFirmName] = useState('')
  const [gstin, setGstin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState(null)
  const [info, setInfo] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLocalError(null)
    setInfo(null)

    if (!fullName.trim() || !firmName.trim() || !email.trim() || !password) {
      setLocalError('Please fill in your name, firm name, email, and password.')
      return
    }
    if (password.length < 6) {
      setLocalError('Password should be at least 6 characters.')
      return
    }

    setSubmitting(true)
    const ok = await onSignUp({ fullName: fullName.trim(), email: email.trim(), password, firmName: firmName.trim(), gstin: gstin.trim() })
    setSubmitting(false)
    if (ok) setInfo("Firm created — you're signed in as Owner.")
  }

  const errorToShow = localError || authError

  return (
    <div className="login-shell" style={{ background: 'var(--ink)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: 32, textAlign: 'left' }}>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
          style={{ background: 'var(--brass)', color: 'var(--ink)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h1 className="font-serif-display text-2xl font-semibold mb-1.5" style={{ color: 'var(--paper)' }}>
          Create your firm
        </h1>
        <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--paper-dim)' }}>
          You'll be set up as Owner, with full access, right away.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Your name">
            <input className="text-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Anuraj" />
          </Field>
          <Field label="Firm name">
            <input className="text-input" value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="NyooKart Apparel" />
          </Field>
          <Field label="GSTIN (optional)">
            <input className="text-input" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="32AAAAA0000A1Z5" />
          </Field>
          <Field label="Email">
            <input type="email" className="text-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourfirm.com" />
          </Field>
          <Field label="Password">
            <input type="password" className="text-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
          </Field>

          {errorToShow && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{errorToShow}</p>}
          {info && <p className="text-[12.5px]" style={{ color: 'var(--teal)' }}>{info}</p>}

          <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%', textAlign: 'center', padding: '10px 0' }}>
            {submitting ? 'Creating…' : 'Create firm'}
          </button>
        </form>

        <p className="login-footnote">
          Already have an account?{' '}
          <button onClick={onSwitchToLogin} className="link-btn" style={{ padding: 0 }}>Sign in instead</button>
        </p>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>{label}</label>
      {children}
    </div>
  )
}
