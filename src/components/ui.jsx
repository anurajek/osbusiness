import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, ChevronDown, ChevronLeft, Check, CalendarDays } from 'lucide-react'
import { inr, toISODate, formatDateDisplay } from '../lib/format'
import { useFloatingPosition } from '../hooks/useFloatingPosition'

// Portal-based replacement for a position:absolute flyout - renders into
// document.body instead of inline, so it's never clipped by a scrollable
// ancestor (a table's own overflow box, a card, anything), and opens
// upward automatically when there's no room below (see
// useFloatingPosition.js for the full reasoning). Every dropdown/menu in
// the app goes through this now: Dropdown and DatePicker below, plus the
// bespoke Assign/Remind/@mention flyouts and the header's Profile/Firm/
// Notification menus, wherever they render a .mention-menu.
//
// triggerRef: ref on the element the menu is anchored to (measured for
// position). open: whether to render at all. onClose: optional, called
// on outside click/Escape - pass it to get click-outside-to-close;
// omit it to keep a consumer's existing toggle-only behavior unchanged.
export function FloatingPanel({ triggerRef, open, onClose, children, className = 'mention-menu', menuWidth = 220, align = 'left', style }) {
  const panelRef = useRef(null)
  const { coords, phase } = useFloatingPosition(triggerRef, panelRef, open, { menuWidth, align })

  useEffect(() => {
    if (!open || !onClose) return undefined
    const handlePointerDown = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      onClose()
    }
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose, triggerRef])

  if (phase === 'closed') return null
  // 'measuring': laid out for real (so it has a real size to measure -
  // visibility:hidden keeps it invisible without collapsing it to zero
  // size the way display:none would) but not yet positioned or
  // interactive. 'positioned': the real, measured placement, visible.
  const measuring = phase === 'measuring'
  return createPortal(
    <div
      ref={panelRef}
      className={className}
      style={{
        position: 'fixed',
        visibility: measuring ? 'hidden' : 'visible',
        pointerEvents: measuring ? 'none' : 'auto',
        left: measuring ? 0 : coords?.left,
        top: measuring ? 0 : coords?.top,
        bottom: measuring ? undefined : coords?.bottom,
        width: measuring ? menuWidth : coords?.width,
        maxHeight: measuring ? undefined : coords?.maxHeight,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body
  )
}

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

// Pulsing placeholder shapes standing in for "Loading…" text while a
// screen's first fetch is in flight - rough approximation of what's
// about to land (a handful of bars per row) so the layout doesn't jump
// once real content replaces it. Two forms: SkeletonBlock for a single
// shape (a stat card, a chart), SkeletonRows for a stack of table-row-
// shaped placeholders.
export function SkeletonBlock({ width = '100%', height = 14, style }) {
  return <div className="skeleton-block" style={{ width, height, ...style }} />
}

export function SkeletonRows({ rows = 5, columns = 3 }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-row" key={i}>
          {Array.from({ length: columns }).map((_, j) => (
            <SkeletonBlock key={j} width={j === 0 ? '30%' : `${70 / (columns - 1)}%`} />
          ))}
        </div>
      ))}
    </div>
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
export function Dropdown({ value, options, onChange, placeholder = 'Select…', className = 'select select--sm', disabled = false, menuAlign = 'left', searchable = false, style }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef(null)
  const normalized = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  const current = normalized.find((o) => o.value === value)
  const label = current ? current.label : placeholder
  // Any class beyond the base select/select--sm ones (e.g. a one-off
  // max-width like .pay-account-select) is almost always a sizing
  // override, not a visual one - applied to the wrapper too so it still
  // constrains the overall width, not just the button inside it.
  const extraClasses = className.split(' ').filter((c) => c !== 'select' && c !== 'select--sm').join(' ')
  // For long lists (customers, suppliers, accounts) - type to filter
  // instead of scrolling to find one. Off by default since it adds a
  // search field nobody needs for a short fixed list like Channel/Tag.
  const filtered = searchable && query.trim()
    ? normalized.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : normalized

  const toggle = () => setOpen((o) => { const next = !o; if (next) setQuery(''); return next })

  return (
    <div className={extraClasses || undefined} style={{ position: 'relative', flex: className.includes('select--sm') ? 1 : undefined, ...style }}>
      <button
        ref={triggerRef}
        type="button" className={className} disabled={disabled}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: disabled ? 'default' : 'pointer', overflow: 'hidden' }}
        onClick={toggle}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>
      <FloatingPanel
        triggerRef={triggerRef} open={open} onClose={() => setOpen(false)}
        align={menuAlign} menuHeight={searchable ? 280 : Math.min(normalized.length * 32 + 12, 260)}
      >
        {searchable && (
          <input
            type="text" className="text-input" autoFocus
            style={{ marginBottom: 4, fontSize: 12.5, padding: '6px 8px' }}
            placeholder="Type to search…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <div style={searchable ? { maxHeight: 220, overflowY: 'auto' } : undefined}>
          {searchable && filtered.length === 0 && <p className="login-footnote" style={{ padding: '6px 8px' }}>No matches.</p>}
          {filtered.map((o) => (
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
      </FloatingPanel>
    </div>
  )
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// The date-input equivalent of Dropdown above (Sep 2026) - a click-to-open
// calendar in the same context-menu style, replacing the native
// <input type="date"> so picking a date feels the same on desktop as it
// already does on mobile (where the OS's own date picker is a proper
// full calendar - on desktop, the same native input is often just three
// typable dd/mm/yyyy segments, a meaningfully worse experience this
// replaces everywhere at once).
//
// value/onChange are plain ISO "YYYY-MM-DD" strings throughout, same as
// the native input this replaces - nothing downstream needs to change.
// className defaults to 'date-input' (the small inline variant); pass
// 'text-input' for the full-width form-field variant - same as the two
// classes the native inputs already used across the app.
export function DatePicker({ value, onChange, className = 'date-input', placeholder = 'dd-mm-yyyy', disabled = false, allowClear = false, menuAlign = 'left', title, style }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayISO = toISODate(today)
  const parsed = value ? new Date(value + 'T00:00:00') : today
  const [viewYear, setViewYear] = useState(parsed.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed.getMonth())

  const openCalendar = () => {
    const d = value ? new Date(value + 'T00:00:00') : today
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setOpen((o) => !o)
  }

  const goPrevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) } else setViewMonth((m) => m - 1) }
  const goNextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) } else setViewMonth((m) => m + 1) }

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay()
  const numDays = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells = [...Array(firstWeekday).fill(null), ...Array(numDays).keys()].map((d) => (d === null ? null : d + 1))

  const pick = (day) => { onChange(toISODate(new Date(viewYear, viewMonth, day))); setOpen(false) }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: className.includes('text-input') ? '100%' : undefined, ...style }}>
      <button
        ref={triggerRef}
        type="button" className={className} disabled={disabled} title={title}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer' }}
        onClick={openCalendar}
      >
        <CalendarDays size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? 'inherit' : 'var(--paper-dim)' }}>{value ? formatDateDisplay(value) : placeholder}</span>
      </button>
      <FloatingPanel
        triggerRef={triggerRef} open={open} onClose={() => setOpen(false)}
        align={menuAlign} menuWidth={240} menuHeight={320}
        style={{ padding: 8, maxWidth: 260 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <button type="button" className="link-btn" style={{ padding: 4 }} onClick={goPrevMonth}><ChevronLeft size={14} /></button>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{monthLabel}</span>
          <button type="button" className="link-btn" style={{ padding: 4 }} onClick={goNextMonth}><ChevronRight size={14} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: 10.5, textAlign: 'center', color: 'var(--paper-dim)', marginBottom: 4 }}>
          {WEEKDAY_LABELS.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {cells.map((day, i) => {
            if (day === null) return <span key={i} />
            const iso = toISODate(new Date(viewYear, viewMonth, day))
            const isSelected = iso === value
            const isToday = iso === todayISO
            return (
              <button
                type="button" key={i} onClick={() => pick(day)}
                style={{
                  padding: '5px 0', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: isSelected ? 'var(--brass)' : 'transparent',
                  color: isSelected ? 'var(--ink)' : 'var(--paper)',
                  fontWeight: isSelected ? 600 : (isToday ? 700 : 400),
                  boxShadow: isToday && !isSelected ? 'inset 0 0 0 1px var(--brass)' : 'none',
                }}
              >
                {day}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, borderTop: '1px solid var(--rule)', paddingTop: 6 }}>
          <button type="button" className="link-btn" onClick={() => { onChange(todayISO); setOpen(false) }}>Today</button>
          {allowClear && value && <button type="button" className="link-btn" onClick={() => { onChange(''); setOpen(false) }}>Clear</button>}
        </div>
      </FloatingPanel>
    </div>
  )
}
