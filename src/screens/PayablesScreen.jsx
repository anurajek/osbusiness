import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, computeStatus } from '../lib/format'
import { PeriodSelector, FilterBar } from '../components/FilterControls'
import { StatCard, StatusPill, EmptyRow, SortableTh } from '../components/ui'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf } from '../lib/pdf'

const PURCHASE_STATUSES_OPEN = ['Approved', 'Partial', 'Due today', 'Overdue']

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
  const [paymentTxns, setPaymentTxns] = useState([])

  useEffect(() => {
    if (!firmId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [{ data: supRows, error: supErr }, { data: billRows, error: billErr }, { data: txnRows, error: txnErr }] = await Promise.all([
        supabase.from('suppliers').select('id, name').eq('firm_id', firmId).order('name'),
        supabase.from('purchase_bills').select('id, supplier_id, bill_no, issued_date, amount, paid_amount, status').eq('firm_id', firmId),
        supabase.from('bank_transactions').select('id, related_purchase_bill_id, txn_date, amount').eq('firm_id', firmId).not('related_purchase_bill_id', 'is', null),
      ])
      if (cancelled) return
      if (supErr || billErr || txnErr) {
        setError((supErr || billErr || txnErr).message)
        setLoading(false)
        return
      }
      setSuppliers(supRows ?? [])
      setBills(billRows ?? [])
      setPaymentTxns(txnRows ?? [])
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
    return billsInPeriod.filter((b) => computeStatus(b, 'Approved') === statusFilter)
  }, [billsInPeriod, statusFilter])

  const rows = useMemo(() => {
    let supList = suppliers
    if (supplierFilter !== 'all') supList = supList.filter((s) => s.id === supplierFilter)

    let result = supList.map((sup) => {
      const supBills = tableBills.filter((b) => b.supplier_id === sup.id)
      const openBills = supBills.filter((b) => computeStatus(b, 'Approved') !== 'Paid')
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

  // Every actual payment made - one row per Record Payment event, not
  // filtered down to bills that happen to be fully settled.
  const paymentsMade = useMemo(() => {
    let list = paymentTxns
    if (range) list = list.filter((t) => { const d = new Date(t.txn_date); return d >= range.from && d <= range.to })
    list = list
      .map((t) => {
        const bill = bills.find((b) => b.id === t.related_purchase_bill_id)
        return { ...t, bill_no: bill?.bill_no || '—', supplier_id: bill?.supplier_id || null }
      })
      .filter((t) => t.supplier_id)
    if (supplierFilter !== 'all') list = list.filter((t) => t.supplier_id === supplierFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((t) => (suppliers.find((s) => s.id === t.supplier_id)?.name || '').toLowerCase().includes(q))
    }
    return list.sort((a, b) => new Date(b.txn_date) - new Date(a.txn_date))
  }, [paymentTxns, range, bills, supplierFilter, search, suppliers])

  const totals = useMemo(() => {
    const billed = billsInPeriod.reduce((s, b) => s + b.amount, 0)
    const paid = billsInPeriod.reduce((s, b) => s + b.paid_amount, 0)
    return { billed, paid, pending: billed - paid }
  }, [billsInPeriod])

  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || '—'

  const handleExportMadeCsv = () => {
    downloadCsv(
      'payables-payments-made',
      ['Payment Date', 'Supplier', 'Bill #', 'Amount Paid'],
      paymentsMade.map((t) => [t.txn_date, supplierName(t.supplier_id), t.bill_no, Math.abs(Number(t.amount)).toFixed(2)])
    )
  }

  const handleExportMadePdf = () => {
    downloadListPdf({
      title: 'Payables — Payments Made',
      firm,
      filename: 'payables-payments-made',
      columns: [
        { label: 'Payment Date' }, { label: 'Supplier' }, { label: 'Bill #' }, { label: 'Amount Paid', align: 'right' },
      ],
      rows: paymentsMade.map((t) => [t.txn_date, supplierName(t.supplier_id), t.bill_no, inr(Math.abs(t.amount))]),
    })
  }

  const handleExportCsv = () => {
    downloadCsv(
      'payables-pending-suppliers',
      ['Supplier', 'Open Bills', 'Amount Due', 'Most Urgent Status'],
      rows.map((r) => [
        r.supplier.name,
        r.openCount,
        r.amountDue.toFixed(2),
        r.mostUrgent ? computeStatus(r.mostUrgent, 'Approved') : '',
      ])
    )
  }

  const handleExportPdf = () => {
    downloadListPdf({
      title: 'Payables — Pending Suppliers',
      firm,
      filename: 'payables-pending-suppliers',
      columns: [
        { label: 'Supplier' }, { label: 'Open Bills', align: 'right' }, { label: 'Amount Due', align: 'right' }, { label: 'Most Urgent' },
      ],
      rows: rows.map((r) => [
        r.supplier.name,
        r.openCount,
        inr(r.amountDue),
        r.mostUrgent ? computeStatus(r.mostUrgent, 'Approved') : '—',
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="section-header__note">{rows.length} supplier{rows.length !== 1 ? 's' : ''} with open bills</span>
            <button className="link-btn" onClick={handleExportCsv} disabled={rows.length === 0}>Export CSV</button>
            <button className="link-btn" onClick={handleExportPdf} disabled={rows.length === 0}>Export PDF</button>
          </span>
        </div>
        <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th className="num">Open bills</th>
              <SortableTh label="Amount due" ascValue="amount-asc" descValue="amount-desc" sortBy={sortBy} onSort={setSortBy} className="num" />
              <th>Most urgent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.supplier.id} className="ledger-row">
                <td>{r.supplier.name}</td>
                <td className="num mono">{r.openCount}</td>
                <td className="num mono">{inr(r.amountDue)}</td>
                <td>{r.mostUrgent ? <StatusPill status={computeStatus(r.mostUrgent, 'Approved')} /> : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={4}>No open payables match these filters.</EmptyRow>}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>Payments Made</h2>
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="section-header__note">{paymentsMade.length} payment{paymentsMade.length !== 1 ? 's' : ''} in this period</span>
            <button className="link-btn" onClick={handleExportMadeCsv} disabled={paymentsMade.length === 0}>Export CSV</button>
            <button className="link-btn" onClick={handleExportMadePdf} disabled={paymentsMade.length === 0}>Export PDF</button>
          </span>
        </div>
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr><th>Payment Date</th><th>Supplier</th><th>Bill</th><th className="num">Amount Paid</th></tr>
            </thead>
            <tbody>
              {paymentsMade.map((t) => (
                <tr key={t.id} className="ledger-row">
                  <td className="mono">{t.txn_date}</td>
                  <td>{supplierName(t.supplier_id)}</td>
                  <td className="mono">{t.bill_no}</td>
                  <td className="num mono">{inr(Math.abs(t.amount))}</td>
                </tr>
              ))}
              {paymentsMade.length === 0 && <EmptyRow colSpan={4}>No payments recorded in this period.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
