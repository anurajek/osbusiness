import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { FirmProvider, useFirm } from './context/FirmContext'
import LoginScreen from './screens/LoginScreen'
import SignupScreen from './screens/SignupScreen'
import AppShell from './components/AppShell'
import DashboardScreen from './screens/DashboardScreen'
import InvoiceListScreen from './screens/InvoiceListScreen'
import ARAPScreen from './screens/ARAPScreen'
import CashBankScreen from './screens/CashBankScreen'
import PermissionsScreen from './screens/PermissionsScreen'

function NoFirmMessage({ userEmail, onCreateFirm, onSignOut, initialError }) {
  const [fullName, setFullName] = useState('')
  const [firmName, setFirmName] = useState('')
  const [gstin, setGstin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(initialError || null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!fullName.trim() || !firmName.trim()) {
      setError('Please fill in your name and firm name.')
      return
    }
    setSubmitting(true)
    const result = await onCreateFirm({ fullName: fullName.trim(), firmName: firmName.trim(), gstin: gstin.trim() })
    setSubmitting(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--ink)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, padding: 32, textAlign: 'left' }}>
        <h1 className="font-serif-display text-xl font-semibold mb-1.5" style={{ color: 'var(--paper)' }}>
          Set up your firm
        </h1>
        <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--paper-dim)' }}>
          {userEmail ? `Signed in as ${userEmail}. ` : ''}
          Your account isn't linked to a firm yet. Create one below and you'll
          be set up as Owner right away — or ask an existing Owner to invite
          you instead.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>Your name</label>
            <input className="text-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Anuraj" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>Firm name</label>
            <input className="text-input" value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="NyooKart Apparel" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>GSTIN (optional)</label>
            <input className="text-input" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="32AAAAA0000A1Z5" />
          </div>

          {error && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{error}</p>}

          <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%', textAlign: 'center', padding: '10px 0' }}>
            {submitting ? 'Creating…' : 'Create firm'}
          </button>
        </form>

        <p className="login-footnote">
          Wrong account?{' '}
          <button onClick={onSignOut} className="link-btn" style={{ padding: 0 }}>Sign out</button>
        </p>
      </div>
    </div>
  )
}

function AuthenticatedApp({ memberships, userEmail, onCreateFirm, initialError, onSignOut }) {
  const [activeModule, setActiveModule] = useState('dashboard')
  const [arapTab, setArapTab] = useState('receivables')

  return (
    <FirmProvider memberships={memberships}>
      <RoutedShell
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        arapTab={arapTab}
        setArapTab={setArapTab}
        userEmail={userEmail}
        onCreateFirm={onCreateFirm}
        initialError={initialError}
        onSignOut={onSignOut}
      />
    </FirmProvider>
  )
}

function RoutedShell({ activeModule, setActiveModule, arapTab, setArapTab, userEmail, onCreateFirm, initialError, onSignOut }) {
  const { permissions, firmId, role } = useFirm()

  const goToModule = (moduleKey, tab) => {
    setActiveModule(moduleKey)
    if (moduleKey === 'arap' && tab) setArapTab(tab)
  }

  if (!firmId) return <NoFirmMessage userEmail={userEmail} onCreateFirm={onCreateFirm} onSignOut={onSignOut} initialError={initialError} />

  const allowed = role === 'Owner' ? { dashboard: true, sales: true, purchases: true, arap: true, cashbank: true, permissions: true } : (permissions || {})

  const renderModule = () => {
    if (!allowed[activeModule]) {
      return <div className="card" style={{ padding: 24 }}>You don't have access to this module.</div>
    }
    switch (activeModule) {
      case 'dashboard': return <DashboardScreen onNavigate={goToModule} />
      case 'sales': return <InvoiceListScreen type="sales" />
      case 'purchases': return <InvoiceListScreen type="purchases" />
      case 'arap': return <ARAPScreen tab={arapTab} onTabChange={setArapTab} />
      case 'cashbank': return <CashBankScreen />
      case 'permissions': return <PermissionsScreen />
      default: return null
    }
  }

  return (
    <AppShell activeModule={activeModule} onNavigate={goToModule} onSignOut={onSignOut}>
      {renderModule()}
    </AppShell>
  )
}

export default function App() {
  const { session, memberships, loading, provisioning, error, signIn, signUpWithFirm, createFirmForSession, signOut } = useAuth()
  const [authMode, setAuthMode] = useState('login')

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ink)', color: 'var(--paper-dim)' }}>
        Loading…
      </div>
    )
  }

  if (!session) {
    return authMode === 'login'
      ? <LoginScreen onSignIn={signIn} authError={error} onSwitchToSignup={() => setAuthMode('signup')} />
      : <SignupScreen onSignUp={signUpWithFirm} authError={error} onSwitchToLogin={() => setAuthMode('login')} />
  }

  // Session exists, but signUpWithFirm's firm/member inserts may still be
  // running (see the comment on `provisioning` in useAuth.js) - without this,
  // the no-firm screen below would flash on-screen mid-signup every time.
  if (provisioning) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ink)', color: 'var(--paper-dim)' }}>
        Setting up your firm…
      </div>
    )
  }

  return (
    <AuthenticatedApp
      memberships={memberships}
      userEmail={session?.user?.email}
      onCreateFirm={createFirmForSession}
      initialError={memberships.length === 0 ? error : null}
      onSignOut={signOut}
    />
  )
}
