import { Search, X } from 'lucide-react'

export const PERIOD_OPTIONS = ['All time', 'Last month', 'Last quarter', 'Last year', 'Custom']

export function PeriodSelector({ period, setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }) {
  return (
    <div className="period-bar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="filter-field" style={{ minWidth: 160 }}>
        <label>Period</label>
        <select className="select select--sm" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIOD_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {period === 'Custom' && (
        <span className="period-custom">
          <input type="date" className="date-input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span className="period-custom__to">to</span>
          <input type="date" className="date-input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </span>
      )}
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

export function FilterBar({ search, filters, sort, exportOptions }) {
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
          <select className="select select--sm" value={f.value} onChange={(e) => f.onChange(e.target.value)}>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
      {sort && (
        <div className="filter-field filter-field--sort">
          <label>Sort by</label>
          <select className="select select--sm" value={sort.value} onChange={(e) => sort.onChange(e.target.value)}>
            {sort.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {exportOptions && (
        <div className="filter-field">
          <label>Export as</label>
          <select
            className="select select--sm"
            value=""
            disabled={exportOptions.disabled}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'excel') exportOptions.onExcel?.()
              else if (v === 'pdf') exportOptions.onPdf?.()
              else if (v === 'word') exportOptions.onWord?.()
            }}
          >
            <option value="" disabled>Export as…</option>
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
            <option value="word">Word</option>
          </select>
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
