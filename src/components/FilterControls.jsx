import { useState } from 'react'
import { Search, X, Plus } from 'lucide-react'
import { Dropdown, DatePicker } from './ui'

export const PERIOD_OPTIONS = ['All time', 'Last month', 'Last quarter', 'Last year', 'Custom']

// The Custom-range date pickers used to sit inline next to the Period
// dropdown, which widened that filter field and reflowed/misaligned the
// whole filter row the moment "Custom" was picked. Now a floating popup
// (same .mention-menu look as every other flyout) instead - opens
// automatically the moment "Custom" is chosen, and can be reopened via
// "Edit dates" afterward, without ever changing the size of the Period
// field itself or anything else in the row.
function PeriodField({ label, period, options = PERIOD_OPTIONS, className }) {
  const [rangeOpen, setRangeOpen] = useState(false)

  const handleChange = (v) => {
    period.onChange(v)
    setRangeOpen(v === 'Custom')
  }

  return (
    <div className={className ?? 'filter-field'} style={{ position: 'relative' }}>
      <label>
        {label ?? 'Period'}
        {period.value === 'Custom' && !rangeOpen && (
          <button type="button" className="link-btn" style={{ marginLeft: 6, fontSize: 10, padding: 0 }} onClick={() => setRangeOpen(true)}>Edit dates</button>
        )}
      </label>
      <Dropdown value={period.value} options={options} onChange={handleChange} />
      {rangeOpen && (
        <div className="mention-menu" style={{ padding: 10, minWidth: 260 }}>
          <div className="chip-row">
            <DatePicker value={period.customFrom} onChange={period.setCustomFrom} />
            <span className="period-custom__to">to</span>
            <DatePicker value={period.customTo} onChange={period.setCustomTo} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setRangeOpen(false)}>Done</button>
          </div>
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
