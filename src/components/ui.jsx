import { useState } from 'react'
import { ChevronRight, ChevronDown, Check } from 'lucide-react'
import { inr } from '../lib/format'

export function Stamp({ ok }) {
  return (
    <span className={`ledger-stamp ${ok ? 'ledger-stamp--ok' : 'ledger-stamp--pending'}`}>
      {ok ? 'RECONCILED' : 'PENDING'}
    </span>
  )
}

const STATUS_PILL_MAP = {
  Paid: 'pill pill--ok',
  Approved: 'pill pill--ok',
  Sent: 'pill pill--neutral',
  'Due today': 'pill pill--warn',
  Partial: 'pill pill--warn',
  Overdue: 'pill pill--bad',
  Cancelled: 'pill pill--neutral',
}

export function StatusPill({ status }) {
  return <span className={STATUS_PILL_MAP[status] || 'pill pill--neutral'}>{status}</span>
}

export function StatCard({ label, value, sub, accent, onClick }) {
  const clickable = !!onClick
  return (
    <div
      className={`card stat-card ${clickable ? 'stat-card--clickable' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
    >
      <div className="stat-card__top">
        <div className="stat-card__label">{label}</div>
        {clickable && <ChevronRight size={14} className="stat-card__chevron" />}
      </div>
      <div className="stat-card__value" style={accent ? { color: 'var(--brass)' } : undefined}>{value}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
    </div>
  )
}

export function SectionHeader({ title, note }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {note && <span className="section-header__note">{note}</span>}
    </div>
  )
}

export function CardLinkHeader({ title, onClick }) {
  return (
    <div
      className="section-header section-header--link"
      style={{ marginBottom: 8 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
    >
      <h2>{title}</h2>
      <ChevronRight size={16} className="section-header__chevron" />
    </div>
  )
}

export function AgingBar({ rows, max }) {
  return (
    <div>
      {rows.map((r) => (
        <div key={r.bucket} className="aging__row">
          <div className="aging__label">{r.bucket}</div>
          <div className="aging__track">
            <div className="aging__fill" style={{ width: `${max ? (r.amount / max) * 100 : 0}%` }} />
          </div>
          <div className="aging__value">{inr(r.amount)}</div>
        </div>
      ))}
    </div>
  )
}

// A clickable table header that drives an existing sortBy/setSortBy pair of
// state values (e.g. 'amount-asc'/'amount-desc') - clicking toggles between
// them, with a small arrow showing which direction is active. This doesn't
// replace a screen's sort *logic* (each screen still owns how each sort
// value actually orders its rows) - it's just a second, more standard way
// to trigger the same sortBy state a FilterBar dropdown already sets.
export function SortableTh({ label, ascValue, descValue, sortBy, onSort, className = '', defaultDesc = true }) {
  const isAsc = sortBy === ascValue
  const isDesc = sortBy === descValue
  const active = isAsc || isDesc
  const handleClick = () => {
    if (isDesc) onSort(ascValue)
    else if (isAsc) onSort(descValue)
    else onSort(defaultDesc ? descValue : ascValue)
  }
  return (
    <th
      className={className}
      onClick={handleClick}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      title={`Sort by ${label}`}
    >
      {label}
      <span style={{ display: 'inline-block', width: 12, opacity: active ? 1 : 0.35, color: active ? 'var(--brass)' : 'inherit' }}>
        {isAsc ? ' ▲' : ' ▼'}
      </span>
    </th>
  )
}

export function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty-state">{children}</td>
    </tr>
  )
}

// Every dropdown in the app now goes through this one component (Sep 2026)
// rather than a native <select> - opens the same context-menu-style
// flyout (.mention-menu, shared with @mention/Assign/Remind) instead of
// the browser's own list, for one consistent feel everywhere.
//
// Deliberately kept to the exact same box as what it replaces: same
// className (so `.select`/`.select--sm` sizing/flex behavior is
// unchanged), same position in the layout - only which kind of menu
// opens on click is different, never the size or alignment.
//
// options: array of plain strings, OR array of { value, label, disabled }
// for cases needing a different display label than the stored value, a
// per-option disabled state, or a dynamically-built list (conditionally
// including/excluding entries with .filter(Boolean) before passing in).
//
// An "action menu" (a picker that always resets rather than keeping a
// selection, e.g. every "Actions..." menu in the app) is just this same
// component with value="" (or any value matching no option) and an
// onChange that fires the action and never stores the picked value back -
// no separate component needed for that pattern.
export function Dropdown({ value, options, onChange, placeholder = 'Select…', className = 'select select--sm', disabled = false, menuAlign = 'left' }) {
  const [open, setOpen] = useState(false)
  const normalized = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  const current = normalized.find((o) => o.value === value)
  const label = current ? current.label : placeholder
  // Any class beyond the base select/select--sm ones (e.g. a one-off
  // max-width like .pay-account-select) is almost always a sizing
  // override, not a visual one - applied to the wrapper too so it still
  // constrains the overall width, not just the button inside it.
  const extraClasses = className.split(' ').filter((c) => c !== 'select' && c !== 'select--sm').join(' ')

  return (
    <div className={extraClasses || undefined} style={{ position: 'relative', flex: className.includes('select--sm') ? 1 : undefined }}>
      <button
        type="button" className={className} disabled={disabled}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: disabled ? 'default' : 'pointer', overflow: 'hidden' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>
      {open && (
        <div className="mention-menu" style={menuAlign === 'right' ? { left: 'auto', right: 0, minWidth: '100%' } : { minWidth: '100%' }}>
          {normalized.map((o) => (
            <button
              type="button" key={o.value} className="mention-menu__item" disabled={o.disabled}
              style={o.disabled ? { opacity: 0.45, cursor: 'default' } : undefined}
              onClick={() => { if (o.disabled) return; onChange(o.value); setOpen(false) }}
            >
              <span className="mention-menu__item-icon">{o.value === value && <Check size={13} />}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
