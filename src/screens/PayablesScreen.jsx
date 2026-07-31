import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange } from '../lib/format'
import { PeriodSelector, FilterBar } from '../components/FilterControls'
import { StatCard, StatusPill, EmptyRow } from '../components/ui'

const PURCHASE_STATUSES_OPEN = ['Approved', 'Due today', 'Overdue']

export default function PayablesScreen() {
  const { firmId } = useFirm()

  const [suppliers, setSuppliers] = useState([])
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('amount-desc')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!firmId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [{ data: supRows, error: supErr }, { data: billRows, error: billErr }] = await Promise.all([
        supabase.from('suppliers').select('id, name').eq('firm_id', firmId).order('name'),
        supabase.from('purchase_bills').select('id, supplier_id, bill_no, issued_date, amount, paid_amount, status').eq('firm_id', firmId),
      ])
      if (cancelled) return
      if (supErr || billErr) {
        setError((supErr || billErr).message)
        setLoading(false)
        return
      }
      setSuppliers(supRows ?? [])
      setBills(billRows ?? [])
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [firmId])

  const range = getPeriodRange(period, customFrom, customTo)

  const billsInPeriod = useMemo(() => {
    if (!range) return bills
    return bills.filter((b) => { const d = new Date(b.issued_date); return d >= range.from && d <= range.to })
  }, [bills, range])

  const tableBills = useMemo(() => {
    if (statusFilter === 'all') return billsInPeriod
    return billsInPeriod.filter((b) => b.status === statusFilter)
  }, [billsInPeriod, statusFilter])

  const rows = useMemo(() => {
    let supList = suppliers
    if (supplierFilter !== 'all') supList = supList.filter((s) => s.id === supplierFilter)

    let result = supList.map((sup) => {
      const supBills = tableBills.filter((b) => b.supplier_id === sup.id)
      const openBills = supBills.filter((b) => b.status !== 'Paid')
      const amountDue = openBills.reduce((s, b) => s + (b.amount - b.paid_amount), 0)
      const mostUrgent = openBills.slice().sort((a, b) => new Date(a.issued_date) - new Date(b.issued_date))[0] || null
      return { supplier: sup, openCount: openBills.length, amountDue, mostUrgent }
    }).filter((r) => r.amountDue > 0)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((r) => r.supplier.name.toLowerCase().includes(q))
    }

    if (sortBy === 'amount-desc') result.sort((a, b) => b.amountDue - a.amountDue)
    else if (sortBy === 'amount-asc') result.sort((a, b) => a.amountDue - b.amountDue)
    else if (sortBy === 'name-asc') result.sort((a, b) => a.supplier.name.localeCompare(b.supplier.name))

    return result
  }, [suppliers, tableBills, supplierFilter, sortBy, search])

  const totals = useMemo(() => {
    const billed = billsInPeriod.reduce((s, b) => s + b.amount, 0)
    const paid = billsInPeriod.reduce((s, b) => s + b.paid_amount, 0)
    return { billed, paid, pending: billed - paid }
  }, [billsInPeriod])

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />

      <div className="grid-3">
        <StatCard label="Billed in period" value={inr(totals.billed)} />
        <StatCard label="Paid in period" value={inr(totals.paid)} accent />
        <StatCard label="Still pending" value={inr(totals.pending)} />
      </div>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search supplier name...' }}
        filters={[
          {
            label: 'Supplier', value: supplierFilter, onChange: setSupplierFilter,
            options: [{ value: 'all', label: 'All' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))],
          },
          {
            label: 'Status', value: statusFilter, onChange: setStatusFilter,
            options: [{ value: 'all', label: 'All open' }, ...PURCHASE_STATUSES_OPEN.map((s) => ({ value: s, label: s }))],
          },
        ]}
        sort={{
          value: sortBy, onChange: setSortBy,
          options: [
            { value: 'amount-desc', label: 'Amount due: high to low' },
            { value: 'amount-asc', label: 'Amount due: low to high' },
            { value: 'name-asc', label: 'Supplier name: A–Z' },
          ],
        }}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>Pending suppliers</h2>
          <span className="section-header__note">{rows.length} supplier{rows.length !== 1 ? 's' : ''} with open bills</span>
        </div>
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th className="num">Open bills</th>
              <th className="num">Amount due</th>
              <th>Most urgent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.supplier.id} className="ledger-row">
                <td>{r.supplier.name}</td>
                <td className="num mono">{r.openCount}</td>
                <td className="num mono">{inr(r.amountDue)}</td>
                <td>{r.mostUrgent ? <StatusPill status={r.mostUrgent.status} /> : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={4}>No open payables match these filters.</EmptyRow>}
          </tbody>
        </table>
      </div>
    </>
  )
}
