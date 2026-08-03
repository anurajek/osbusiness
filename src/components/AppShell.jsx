import { useState } from 'react'
import {
  LayoutDashboard, ShoppingCart, Package, Landmark, TrendingUp,
  ShieldCheck, LogOut, ChevronDown, Menu, X, Building2, UploadCloud,
} from 'lucide-react'
import { useFirm } from '../context/FirmContext'

// Refocused on AR/AP collections (Aug 2026) - Quotations, Credit/Debit
// Notes, and the General Ledger are deliberately hidden from nav, not
// deleted. All three still exist in full (screens, migrations, RLS) and
// have zero data loss - re-enabling any of them later is just adding their
// entry back to this list (and to PermissionsScreen.jsx's MODULES array,
// which mirrors this one for the per-member toggle grid). See README's
// "Scope: AR/AP focus" section for the full reasoning.
const MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'sales', label: 'Sales', icon: ShoppingCart },
  { key: 'purchases', label: 'Purchases', icon: Package },
  { key: 'arap', label: 'AR / AP', icon: TrendingUp },
  { key: 'cashbank', label: 'Cash & Bank', icon: Landmark },
  { key: 'import', label: 'Import Data', icon: UploadCloud },
  { key: 'permissions', label: 'Users & Permissions', icon: ShieldCheck },
]

export default function AppShell({ activeModule, onNavigate, onSignOut, children }) {
  const { memberships, firmId, setFirmId, firm, role, permissions } = useFirm()
  const [navOpen, setNavOpen] = useState(false)
  const [firmMenuOpen, setFirmMenuOpen] = useState(false)

  const visibleModules = role === 'Owner' ? MODULES : MODULES.filter((m) => permissions?.[m.key])

  return (
    <div className="app-shell">
      <aside className={`sidebar ${navOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <Landmark size={18} /> <span>Ledger OS</span>
        </div>
        <nav className="sidebar__nav">
          {visibleModules.map((m) => {
            const Icon = m.icon
            return (
              <button
                key={m.key}
                className={`nav-item ${activeModule === m.key ? 'nav-item--active' : ''}`}
                onClick={() => { onNavigate(m.key); setNavOpen(false) }}
              >
                <Icon size={16} /> <span>{m.label}</span>
              </button>
            )
          })}
        </nav>
        <button className="nav-item nav-item--logout" onClick={onSignOut}>
          <LogOut size={16} /> <span>Sign out</span>
        </button>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="hamburger" onClick={() => setNavOpen((v) => !v)}>
            {navOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div style={{ position: 'relative' }}>
            <button className="topbar__firm" onClick={() => setFirmMenuOpen((v) => !v)}>
              <Building2 size={15} />
              <span>{firm?.name ?? 'Select firm'}</span>
              {firm?.gstin && <span className="topbar__gstin">{firm.gstin}</span>}
              {memberships.length > 1 && <ChevronDown size={14} />}
            </button>
            {firmMenuOpen && memberships.length > 1 && (
              <div
                className="card"
                style={{ position: 'absolute', top: '110%', left: 0, zIndex: 30, minWidth: 220, padding: 6 }}
              >
                {memberships.map((m) => (
                  <button
                    key={m.firm_id}
                    className={`nav-item ${m.firm_id === firmId ? 'nav-item--active' : ''}`}
                    onClick={() => { setFirmId(m.firm_id); setFirmMenuOpen(false) }}
                  >
                    <Building2 size={14} /> <span>{m.firms?.name ?? m.firm_id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="topbar__user">
            <span className="role-badge">{role}</span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  )
}
