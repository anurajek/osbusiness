import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, computeStatus } from '../lib/format'
import { PeriodSelector, FilterBar } from '../components/FilterControls'
import { StatCard, StatusPill, EmptyRow, SortableTh } from '../components/ui'
import CommDrawer from '../components/CommDrawer'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf } from '../lib/pdf'
import { downloadListDocx } from '../lib/exportDocx'

// "Paid" sits alongside the open statuses in the same dropdown now, rather
// than living in a separate report - selecting it just changes what this
// one table shows and how its amount column is computed (paid instead of
// due).
const PURCHASE_STATUSES = ['Approved', 'Partial', 'Due today', 'Overdue', 'Paid']

export default function PayablesScreen({ navParams, clearNavParams }) {
  const { firmId, firm } = useFirm()

  const [suppliers, setSuppliers] = useState([])
  const [bills, setBills] = useState([])
  const [comms, setComms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('amount-desc')
  const [search, setSearch] = useState('')
  const [selectedSupplierId, setSelectedSupplierId] = useState(null)

  // Arriving here from a click elsewhere (e.g. a supplier's name in
  // Purchases) pre-filters to that one supplier.
  useEffect(() => {
    if (navParams?.supplierId) {
      setSupplierFilter(navParams.supplierId)
      clearNavParams?.()
    }
  }, [navParams, clearNavParams])

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [{ data: supRows, error: supErr }, { data: billRows, error: billErr }, { data: commRows, error: commErr }] = await Promise.all([
      supabase.from('suppliers').select('id, name').eq('firm_id', firmId).order('name'),
      supabase.from('purchase_bills').select('id, supplier_id, bill_no, issued_date, amount, paid_amount, status, is_cancelled').eq('firm_id', firmId),
      supabase.from('supplier_comms').select('id, supplier_id, channel, tag, note, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }),
    ])
    if (supErr || billErr || commErr) {
      setError((supErr || billErr || commErr).message)
      setLoading(false)
      return
    }
    setSuppliers(supRows ?? [])
    // A cancelled bill is void - it shouldn't count toward what's owed (or
    // what's been paid) at all, the same way this screen already never
    // counted a deleted record. Filtered out here, once, rather than
    // threaded through every downstream calculation individually.
    setBills((billRows ?? []).filter((b) => !b.is_cancelled))
    setComms(commRows ?? [])
    setLoading(false)
  }, [firmId])

  useEffect(() => { load() }, [load])

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

  const lastCommFor = (supplierId) => comms.find((c) => c.supplier_id === supplierId) || null

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
      return { supplier: sup, count: relevant.length, amount, mostUrgent, lastComm: lastCommFor(sup.id) }
    }).filter((r) => r.count > 0)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((r) => r.supplier.name.toLowerCase().includes(q))
    }

    if (sortBy === 'amount-desc') result.sort((a, b) => b.amount - a.amount)
    else if (sortBy === 'amount-asc') result.sort((a, b) => a.amount - b.amount)
    else if (sortBy === 'name-asc') result.sort((a, b) => a.supplier.name.localeCompare(b.supplier.name))
    else if (sortBy === 'last-contact') result.sort((a, b) => new Date(b.lastComm?.created_at ?? 0) - new Date(a.lastComm?.created_at ?? 0))

    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers, tableBills, supplierFilter, sortBy, search, statusFilter, isPaidView, comms])

  const totals = useMemo(() => {
    const billed = billsInPeriod.reduce((s, b) => s + b.amount, 0)
    const paid = billsInPeriod.reduce((s, b) => s + b.paid_amount, 0)
    return { billed, paid, pending: billed - paid }
  }, [billsInPeriod])

  const addComm = async ({ channel, tag, note }) => {
    setSaving(true)
    const { error: insertErr } = await supabase.from('supplier_comms').insert({
      firm_id: firmId, supplier_id: selectedSupplierId, channel, tag, note,
    })
    setSaving(false)
    if (insertErr) { alert(`Couldn't save that update: ${insertErr.message}`); return }
    await load()
  }

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId)

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
            { value: 'last-contact', label: 'Last contact: most recent' },
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
              <th>Last update</th>
              <th>Last contact</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.supplier.id} className="ledger-row ledger-row--clickable" onClick={() => setSelectedSupplierId(r.supplier.id)}>
                <td>{r.supplier.name}</td>
                <td className="num mono">{r.count}</td>
                <td className="num mono">{inr(r.amount)}</td>
                {!isPaidView && <td>{r.mostUrgent ? <StatusPill status={computeStatus(r.mostUrgent, 'Approved')} /> : '—'}</td>}
                <td>
                  {r.lastComm
                    ? <span className="comm-tag">{r.lastComm.tag}</span>
                    : <span className="pill pill--neutral">No follow-up yet</span>}
                </td>
                <td className="mono">{r.lastComm ? new Date(r.lastComm.created_at).toLocaleDateString() : '—'}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="link-btn" onClick={(e) => { e.stopPropagation(); setSelectedSupplierId(r.supplier.id) }}>View details</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={isPaidView ? 6 : 7}>No {isPaidView ? 'paid' : 'open'} payables match these filters.</EmptyRow>}
          </tbody>
        </table>
        </div>
      </div>

      {selectedSupplier && (
        <CommDrawer
          customer={selectedSupplier}
          docLabel="Bill"
          openDocs={bills
            .filter((b) => b.supplier_id === selectedSupplier.id)
            .map((b) => ({ ...b, liveStatus: computeStatus(b, 'Approved') }))
            .filter((b) => b.liveStatus !== 'Paid')
            .map((b) => ({ id: b.id, number: b.bill_no, issued_date: b.issued_date, amountDue: b.amount - b.paid_amount, statusLabel: b.liveStatus }))}
          comms={comms.filter((c) => c.supplier_id === selectedSupplier.id)}
          onAddComm={addComm}
          onClose={() => setSelectedSupplierId(null)}
          saving={saving}
        />
      )}
    </>
  )
}
