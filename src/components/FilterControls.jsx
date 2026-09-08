import { useState } from 'react'
import { Search, X, Plus, ChevronDown, Check } from 'lucide-react'
import { Dropdown, DatePicker } from './ui'

export const PERIOD_OPTIONS = ['All time', 'Last month', 'Last quarter', 'Last year', 'Custom']

// Previously: the Period dropdown's own option list and the Custom-range
// date pickers were two separate flyouts that could both end up open at
// once (re-clicking the trigger while the range picker was already open
// reopened the plain option list on top of it) - that's what produced the
// cramped, overlapping mess. Now it's one single flyout: the option list,
// and if Custom is selected, the date range appended right inside that
// same popup - nothing to collide with. From/To are stacked (not side by
// side) so each DatePicker gets the popup's full width to open its own
// calendar in, rather than fighting two into a half-width column.
function PeriodField({ label, period, options = PERIOD_OPTIONS, className }) {
  const [open, setOpen] = useState(false)
  const isCustom = period.value === 'Custom'

  return (
    <div className={className ?? 'filter-field'} style={{ position: 'relative' }}>
      <label>{label ?? 'Period'}</label>
      <button
        type="button" className="select select--sm"
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer', overflow: 'hidden' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{period.value}</span>
        <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>
      {open && (
        <div className="mention-menu" style={{ minWidth: isCustom ? 240 : '100%', maxHeight: 'none', overflow: 'visible' }}>
          {options.map((o) => (
            <button
              type="button" key={o} className="mention-menu__item"
              onClick={() => { period.onChange(o); if (o !== 'Custom') setOpen(false) }}
            >
              <span className="mention-menu__item-icon">{o === period.value && <Check size={13} />}</span>
              {o}
            </button>
          ))}
          {isCustom && (
            <>
              <div className="mention-menu__divider" />
              <div style={{ padding: '4px 10px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>From</label>
                  <DatePicker className="text-input" value={period.customFrom} onChange={period.setCustomFrom} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>To</label>
                  <DatePicker className="text-input" value={period.customTo} onChange={period.setCustomTo} />
                </div>
                <button type="button" className="btn-primary" style={{ padding: '6px 12px', fontSize: 12, alignSelf: 'flex-end' }} onClick={() => setOpen(false)}>Done</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function PeriodSelector({ period, setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }) {
  return (
    <div className="period-bar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <PeriodField
        period={{ value: period, onChange: setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }}
        className="filter-field"
      />
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="search-box">
      <Search size={14} className="search-box__icon" />
      <input
        type="text"
        className="search-box__input"
        placeholder={placeholder || 'Search...'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="search-box__clear" onClick={() => onChange('')} aria-label="Clear search">
          <X size={13} />
        </button>
      )}
    </div>
  )
}

export function FilterBar({ addAction, search, filters, period, sort, exportOptions }) {
  return (
    <div className="filter-bar">
      {search && (
        <div className="filter-field filter-field--search">
          <label>Search</label>
          <SearchInput value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
        </div>
      )}
      {filters.map((f) => (
        <div key={f.label} className="filter-field">
          <label>{f.label}</label>
          <Dropdown value={f.value} options={f.options} onChange={f.onChange} searchable={f.searchable} />
        </div>
      ))}
      {period && <PeriodField period={period} />}
      {sort && (
        <div className="filter-field filter-field--sort">
          <label>Sort by</label>
          <Dropdown value={sort.value} options={sort.options} onChange={sort.onChange} />
        </div>
      )}
      {exportOptions && (
        <div className="filter-field">
          <label>Export as</label>
          <Dropdown
            value="" placeholder="Export as…" disabled={exportOptions.disabled}
            options={[
              { value: 'excel', label: 'Excel' },
              { value: 'pdf', label: 'PDF' },
              { value: 'word', label: 'Word' },
            ]}
            onChange={(v) => {
              if (v === 'excel') exportOptions.onExcel?.()
              else if (v === 'pdf') exportOptions.onPdf?.()
              else if (v === 'word') exportOptions.onWord?.()
            }}
          />
        </div>
      )}
      {addAction && (
        <div className="filter-field" style={{ justifyContent: 'flex-end' }}>
          <label>&nbsp;</label>
          <button type="button" className="link-btn" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} onClick={addAction.onClick}>
            <Plus size={14} /> {addAction.label ?? 'Add'}
          </button>
        </div>
      )}
    </div>
  )
}

export const SORT_OPTIONS_DATE_AMOUNT = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'amount-desc', label: 'Amount: high to low' },
  { value: 'amount-asc', label: 'Amount: low to high' },
]

export function sortRows(list, sortBy, dateKey, amountKey = 'amount') {
  const sorted = [...list]
  if (sortBy === 'date-desc') sorted.sort((a, b) => new Date(b[dateKey]) - new Date(a[dateKey]))
  else if (sortBy === 'date-asc') sorted.sort((a, b) => new Date(a[dateKey]) - new Date(b[dateKey]))
  else if (sortBy === 'amount-desc') sorted.sort((a, b) => Math.abs(b[amountKey]) - Math.abs(a[amountKey]))
  else if (sortBy === 'amount-asc') sorted.sort((a, b) => Math.abs(a[amountKey]) - Math.abs(b[amountKey]))
  return sorted
}
