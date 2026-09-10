import { useState } from 'react'
import {
  LayoutDashboard, ShoppingCart, Package, Landmark, TrendingUp,
  ShieldCheck, LogOut, ChevronDown, Menu, X, Building2, UploadCloud, Sun, Moon, ListChecks,
  PanelLeft, PanelTop, CircleUserRound,
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
  { key: 'tasks', label: 'Assigned Tasks', icon: ListChecks },
  { key: 'sales', label: 'Sales', icon: ShoppingCart },
  { key: 'purchases', label: 'Purchases', icon: Package },
  { key: 'arap', label: 'AR / AP', icon: TrendingUp },
  { key: 'cashbank', label: 'Cash & Bank', icon: Landmark },
  { key: 'import', label: 'Import Data', icon: UploadCloud },
  { key: 'permissions', label: 'Users & Permissions', icon: ShieldCheck },
]

// navLayout is a pure display preference (see useLayoutPref.js) - doesn't
// touch which modules a person can see (still role/permissions), only
// whether the nav renders as the original left-hand column ('sidebar') or
// a horizontal bar under the header ('topbar'). 'sidebar' keeps its own
// mobile hamburger/slide-out behavior unchanged; 'topbar' just scrolls
// horizontally on a narrow screen instead, the same way filter bars and
// wide tables already do elsewhere in the app - no second slide-out
// mechanism to build and keep in sync with the first.
//
// Sign Out lives in exactly one place regardless of layout - the header's
// top-right corner - rather than moving to the bottom of the sidebar in
// that layout and back for topbar. One fixed location, always findable.
export default function AppShell({ activeModule, onNavigate, onSignOut, theme, toggleTheme, navLayout, toggleNavLayout, userEmail, children }) {
  const { memberships, firmId, setFirmId, firm, role, memberName, permissions } = useFirm()
  const [navOpen, setNavOpen] = useState(false)
  const [firmMenuOpen, setFirmMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  // Same "respect the Owner's own stored permissions, but permissions
  // itself is never actually hideable" reasoning as App.jsx's routing
  // guard - see migration_owner_permissions_toggle.sql.
  const visibleModules = MODULES.filter((m) => (role === 'Owner' && m.key === 'permissions') || permissions?.[m.key])
  const isTopbar = navLayout === 'topbar'

  return (
    <div className="app-shell">
      {!isTopbar && (
        <aside className={`sidebar ${navOpen ? 'sidebar--open' : ''}`}>
          <div className="sidebar__brand">
            <Landmark size={18} /> <span>FinoPilo Flow</span>
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
        </aside>
      )}

      <div className="main-col">
        <header className="topbar">
          {!isTopbar && (
            <button className="hamburger" onClick={() => setNavOpen((v) => !v)}>
              {navOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          )}

          {isTopbar && (
            <div className="sidebar__brand" style={{ padding: '4px 8px 4px 0' }}>
              <Landmark size={18} /> <span>FinoPilo Flow</span>
            </div>
          )}

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
            <button
              className="theme-toggle"
              onClick={toggleNavLayout}
              title={isTopbar ? 'Switch to left-side navigation' : 'Switch to top navigation'}
              aria-label={isTopbar ? 'Switch to left-side navigation' : 'Switch to top navigation'}
            >
              {isTopbar ? <PanelLeft size={16} /> : <PanelTop size={16} />}
            </button>
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div style={{ position: 'relative' }}>
              <button
                className="theme-toggle"
                onClick={() => setProfileOpen((v) => !v)}
                title="Profile"
                aria-label="Profile"
              >
                <CircleUserRound size={16} />
              </button>
              {profileOpen && (
                <div className="mention-menu" style={{ left: 'auto', right: 0, padding: 12, minWidth: 220 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{memberName || 'Unnamed member'}</div>
                  <div style={{ fontSize: 12, color: 'var(--paper-dim)', marginBottom: 3 }}>Designation: {role}</div>
                  <div style={{ fontSize: 12, color: 'var(--paper-dim)' }}>Mail ID: {userEmail || '—'}</div>
                </div>
              )}
            </div>
            <button className="theme-toggle" onClick={onSignOut} title="Sign out" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {isTopbar && (
          <nav className="topnav">
            {visibleModules.map((m) => {
              const Icon = m.icon
              return (
                <button
                  key={m.key}
                  className={`nav-item nav-item--horizontal ${activeModule === m.key ? 'nav-item--active' : ''}`}
                  onClick={() => onNavigate(m.key)}
                >
                  <Icon size={15} /> <span>{m.label}</span>
                </button>
              )
            })}
          </nav>
        )}

        <main className="main-content">{children}</main>
      </div>
    </div>
  )
}
