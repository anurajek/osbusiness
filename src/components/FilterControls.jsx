import { Search, X, Plus } from 'lucide-react'
import { Dropdown, DatePicker } from './ui'

export const PERIOD_OPTIONS = ['All time', 'Last month', 'Last quarter', 'Last year', 'Custom']

export function PeriodSelector({ period, setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }) {
  return (
    <div className="period-bar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="filter-field" style={{ minWidth: 160 }}>
        <label>Period</label>
        <Dropdown value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
      </div>
      {period === 'Custom' && (
        <span className="period-custom">
          <DatePicker value={customFrom} onChange={setCustomFrom} />
          <span className="period-custom__to">to</span>
          <DatePicker value={customTo} onChange={setCustomTo} />
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
          <Dropdown value={f.value} options={f.options} onChange={f.onChange} />
        </div>
      ))}
      {period && (
        <div className="filter-field">
          <label>Period</label>
          <Dropdown value={period.value} options={PERIOD_OPTIONS} onChange={period.onChange} />
          {period.value === 'Custom' && (
            <span className="period-custom" style={{ marginTop: 6 }}>
              <DatePicker value={period.customFrom} onChange={period.setCustomFrom} />
              <span className="period-custom__to">to</span>
              <DatePicker value={period.customTo} onChange={period.setCustomTo} />
            </span>
          )}
        </div>
      )}
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
