import { ChevronRight } from 'lucide-react'
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
