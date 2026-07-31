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

function NoFirmMessage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--ink)' }}>
      <div className="card" style={{ maxWidth: 420 }}>
        <h1 className="font-serif-display text-xl font-semibold mb-2" style={{ color: 'var(--paper)' }}>
          No firm linked yet
        </h1>
        <p className="text-sm" style={{ color: 'var(--paper-dim)' }}>
          Your account isn't linked to a firm yet. Ask an Owner to add you in
          Supabase's firm_members table, or insert one yourself if this is
          your own firm's first setup.
        </p>
      </div>
    </div>
  )
}

function AuthenticatedApp({ memberships, onSignOut }) {
  const [activeModule, setActiveModule] = useState('dashboard')
  const [arapTab, setArapTab] = useState('receivables')

  return (
    <FirmProvider memberships={memberships}>
      <RoutedShell
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        arapTab={arapTab}
        setArapTab={setArapTab}
        onSignOut={onSignOut}
      />
    </FirmProvider>
  )
}

function RoutedShell({ activeModule, setActiveModule, arapTab, setArapTab, onSignOut }) {
  const { permissions, firmId, role } = useFirm()

  const goToModule = (moduleKey, tab) => {
    setActiveModule(moduleKey)
    if (moduleKey === 'arap' && tab) setArapTab(tab)
  }

  if (!firmId) return <NoFirmMessage />

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
  const { session, memberships, loading, error, signIn, signUpWithFirm, signOut } = useAuth()
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

  return <AuthenticatedApp memberships={memberships} onSignOut={signOut} />
}
