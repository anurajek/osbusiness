import { useAuth } from './hooks/useAuth'
import LoginScreen from './screens/LoginScreen'

// This is a deliberately minimal "logged in" shell for now. It proves the
// real Supabase Auth + firm_members pipeline works end-to-end. Wiring the
// actual Dashboard/Sales/Receivables/etc. screens to real data is the next
// piece of work, once this foundation is confirmed working.
function SignedInPlaceholder({ memberships, onSignOut }) {
  return (
    <div className="min-h-screen p-8" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
      <div
        className="max-w-lg mx-auto rounded-[10px] p-6"
        style={{ background: 'var(--panel)', border: '1px solid var(--rule)' }}
      >
        <h1 className="font-serif-display text-xl font-semibold mb-1">You're signed in</h1>
        <p className="text-[13px] mb-4" style={{ color: 'var(--paper-dim)' }}>
          Real Supabase Auth is working. Here's what your account is linked to:
        </p>

        {memberships.length === 0 && (
          <p className="text-[13px]" style={{ color: 'var(--brick)' }}>
            No firm_members row found for this user yet — insert one in Supabase
            linking your auth user to a firm before continuing.
          </p>
        )}

        <ul className="flex flex-col gap-2 mb-5">
          {memberships.map((m) => (
            <li
              key={m.id}
              className="rounded-lg px-3 py-2 text-sm flex items-center justify-between"
              style={{ background: 'var(--panel-alt)', border: '1px solid var(--rule)' }}
            >
              <span>{m.firms?.name ?? m.firm_id}</span>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'var(--brass)', color: 'var(--ink)' }}
              >
                {m.role}
              </span>
            </li>
          ))}
        </ul>

        <button
          onClick={onSignOut}
          className="text-[13px] font-medium"
          style={{ color: 'var(--paper-dim)' }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { session, memberships, loading, error, signIn, signOut } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ink)', color: 'var(--paper-dim)' }}>
        Loading…
      </div>
    )
  }

  if (!session) {
    return <LoginScreen onSignIn={signIn} authError={error} />
  }

  return <SignedInPlaceholder memberships={memberships} onSignOut={signOut} />
}
