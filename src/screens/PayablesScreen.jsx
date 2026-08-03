import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, computeStatus } from '../lib/format'
import { PeriodSelector, FilterBar } from '../components/FilterControls'
import { StatCard, StatusPill, EmptyRow, SortableTh } from '../components/ui'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf } from '../lib/pdf'
import { downloadListDocx } from '../lib/exportDocx'

// "Paid" sits alongside the open statuses in the same dropdown now, rather
// than living in a separate report - selecting it just changes what this
// one table shows and how its amount column is computed (paid instead of
// due).
const PURCHASE_STATUSES = ['Approved', 'Partial', 'Due today', 'Overdue', 'Paid']

export default function PayablesScreen() {
  const { firmId, firm } = useFirm()

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
  const isPaidView = statusFilter === 'Paid'

  const billsInPeriod = useMemo(() => {
    if (!range) return bills
    return bills.filter((b) => { const d = new Date(b.issued_date); return d >= range.from && d <= range.to })
  }, [bills, range])

  const tableBills = useMemo(() => {
    if (statusFilter === 'all') return billsInPeriod
    return billsInPeriod.filter((b) => computeStatus(b, 'Approved') === statusFilter)
  }, [billsInPeriod, statusFilter])

  const rows = useMemo(() => {
    let supList = suppliers
    if (supplierFilter !== 'all') supList = supList.filter((s) => s.id === supplierFilter)

    let result = supList.map((sup) => {
      const supBills = tableBills.filter((b) => b.supplier_id === sup.id)
      // "All open" (the default) still needs to exclude Paid bills by hand,
      // since tableBills isn't scoped to any one status in that case. Any
      // specific status already selected - including Paid - is already
      // correctly scoped by tableBills above.
      const relevant = statusFilter === 'all' ? supBills.filter((b) => computeStatus(b, 'Approved') !== 'Paid') : supBills
      const amount = isPaidView
        ? relevant.reduce((s, b) => s + b.paid_amount, 0)
        : relevant.reduce((s, b) => s + (b.amount - b.paid_amount), 0)
      const mostUrgent = relevant.slice().sort((a, b) => new Date(a.issued_date) - new Date(b.issued_date))[0] || null
      return { supplier: sup, count: relevant.length, amount, mostUrgent }
    }).filter((r) => r.count > 0)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((r) => r.supplier.name.toLowerCase().includes(q))
    }

    if (sortBy === 'amount-desc') result.sort((a, b) => b.amount - a.amount)
    else if (sortBy === 'amount-asc') result.sort((a, b) => a.amount - b.amount)
    else if (sortBy === 'name-asc') result.sort((a, b) => a.supplier.name.localeCompare(b.supplier.name))

    return result
  }, [suppliers, tableBills, supplierFilter, sortBy, search, statusFilter, isPaidView])

  const totals = useMemo(() => {
    const billed = billsInPeriod.reduce((s, b) => s + b.amount, 0)
    const paid = billsInPeriod.reduce((s, b) => s + b.paid_amount, 0)
    return { billed, paid, pending: billed - paid }
  }, [billsInPeriod])

  const handleExportCsv = () => {
    downloadCsv(
      'payables-suppliers',
      ['Supplier', isPaidView ? 'Paid Bills' : 'Open Bills', isPaidView ? 'Amount Paid' : 'Amount Due', isPaidView ? '' : 'Most Urgent Status'],
      rows.map((r) => [
        r.supplier.name,
        r.count,
        r.amount.toFixed(2),
        isPaidView ? '' : (r.mostUrgent ? computeStatus(r.mostUrgent, 'Approved') : ''),
      ])
    )
  }

  const handleExportPdf = () => {
    downloadListPdf({
      title: isPaidView ? 'Payables — Paid Suppliers' : 'Payables — Pending Suppliers',
      firm,
      filename: 'payables-suppliers',
      columns: [
        { label: 'Supplier' }, { label: isPaidView ? 'Paid Bills' : 'Open Bills', align: 'right' },
        { label: isPaidView ? 'Amount Paid' : 'Amount Due', align: 'right' },
        ...(isPaidView ? [] : [{ label: 'Most Urgent' }]),
      ],
      rows: rows.map((r) => [
        r.supplier.name,
        r.count,
        inr(r.amount),
        ...(isPaidView ? [] : [r.mostUrgent ? computeStatus(r.mostUrgent, 'Approved') : '—']),
      ]),
    })
  }

  const handleExportWord = () => {
    downloadListDocx({
      title: isPaidView ? 'Payables — Paid Suppliers' : 'Payables — Pending Suppliers',
      firm,
      filename: 'payables-suppliers',
      columns: [
        { label: 'Supplier' }, { label: isPaidView ? 'Paid Bills' : 'Open Bills', align: 'right' },
        { label: isPaidView ? 'Amount Paid' : 'Amount Due', align: 'right' },
        ...(isPaidView ? [] : [{ label: 'Most Urgent' }]),
      ],
      rows: rows.map((r) => [
        r.supplier.name,
        r.count,
        inr(r.amount),
        ...(isPaidView ? [] : [r.mostUrgent ? computeStatus(r.mostUrgent, 'Approved') : '—']),
      ]),
    })
  }

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
            options: [{ value: 'all', label: 'All open' }, ...PURCHASE_STATUSES.map((s) => ({ value: s, label: s }))],
          },
        ]}
        sort={{
          value: sortBy, onChange: setSortBy,
          options: [
            { value: 'amount-desc', label: `Amount ${isPaidView ? 'paid' : 'due'}: high to low` },
            { value: 'amount-asc', label: `Amount ${isPaidView ? 'paid' : 'due'}: low to high` },
            { value: 'name-asc', label: 'Supplier name: A–Z' },
          ],
        }}
        exportOptions={{ onExcel: handleExportCsv, onPdf: handleExportPdf, onWord: handleExportWord, disabled: rows.length === 0 }}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>{isPaidView ? 'Paid suppliers' : 'Pending suppliers'}</h2>
          <span className="section-header__note">{rows.length} supplier{rows.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th className="num">{isPaidView ? 'Paid bills' : 'Open bills'}</th>
              <SortableTh label={isPaidView ? 'Amount paid' : 'Amount due'} ascValue="amount-asc" descValue="amount-desc" sortBy={sortBy} onSort={setSortBy} className="num" />
              {!isPaidView && <th>Most urgent</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.supplier.id} className="ledger-row">
                <td>{r.supplier.name}</td>
                <td className="num mono">{r.count}</td>
                <td className="num mono">{inr(r.amount)}</td>
                {!isPaidView && <td>{r.mostUrgent ? <StatusPill status={computeStatus(r.mostUrgent, 'Approved')} /> : '—'}</td>}
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={isPaidView ? 3 : 4}>No {isPaidView ? 'paid' : 'open'} payables match these filters.</EmptyRow>}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}
