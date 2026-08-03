import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, computeStatus } from '../lib/format'
import { PeriodSelector, FilterBar } from '../components/FilterControls'
import { StatCard, EmptyRow, SortableTh } from '../components/ui'
import CommDrawer from '../components/CommDrawer'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf } from '../lib/pdf'
import { downloadListDocx } from '../lib/exportDocx'

// "Paid" sits alongside the open statuses in the same dropdown now, rather
// than living in a separate report - selecting it just changes what this
// one table shows and how its amount column is computed (received instead
// of due).
const SALES_STATUSES = ['Sent', 'Partial', 'Due today', 'Overdue', 'Paid']

export default function ReceivablesScreen() {
  const { firmId, firm } = useFirm()

  const [customers, setCustomers] = useState([])
  const [invoices, setInvoices] = useState([])
  const [comms, setComms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customerFilter, setCustomerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('amount-desc')
  const [search, setSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)

  const loadAll = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)

    const [{ data: custRows, error: custErr }, { data: invRows, error: invErr }, { data: commRows, error: commErr }] = await Promise.all([
      supabase.from('customers').select('id, name').eq('firm_id', firmId).order('name'),
      supabase.from('sales_invoices').select('id, customer_id, invoice_no, issued_date, amount, paid_amount, status').eq('firm_id', firmId),
      supabase.from('ar_comms').select('id, customer_id, channel, tag, note, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }),
    ])

    if (custErr || invErr || commErr) {
      setError((custErr || invErr || commErr).message)
      setLoading(false)
      return
    }
    setCustomers(custRows ?? [])
    setInvoices(invRows ?? [])
    setComms(commRows ?? [])
    setLoading(false)
  }, [firmId])

  useEffect(() => { loadAll() }, [loadAll])

  const range = getPeriodRange(period, customFrom, customTo)
  const isPaidView = statusFilter === 'Paid'

  const invoicesInPeriod = useMemo(() => {
    if (!range) return invoices
    return invoices.filter((inv) => {
      const d = new Date(inv.issued_date)
      return d >= range.from && d <= range.to
    })
  }, [invoices, range])

  const tableInvoices = useMemo(() => {
    if (statusFilter === 'all') return invoicesInPeriod
    return invoicesInPeriod.filter((i) => computeStatus(i, 'Sent') === statusFilter)
  }, [invoicesInPeriod, statusFilter])

  const lastCommFor = (customerId) => comms.find((c) => c.customer_id === customerId) || null

  const rows = useMemo(() => {
    let custList = customers
    if (customerFilter !== 'all') custList = custList.filter((c) => c.id === customerFilter)

    let result = custList.map((cust) => {
      const custInvoices = tableInvoices.filter((i) => i.customer_id === cust.id)
      // "All open" (the default) still needs to exclude Paid invoices by
      // hand, since tableInvoices isn't scoped to any one status in that
      // case. Any specific status already selected - including Paid - is
      // already correctly scoped by tableInvoices above, so nothing extra
      // to filter here.
      const relevant = statusFilter === 'all' ? custInvoices.filter((i) => computeStatus(i, 'Sent') !== 'Paid') : custInvoices
      const amount = isPaidView
        ? relevant.reduce((s, i) => s + i.paid_amount, 0)
        : relevant.reduce((s, i) => s + (i.amount - i.paid_amount), 0)
      return { customer: cust, count: relevant.length, amount, lastComm: lastCommFor(cust.id) }
    }).filter((r) => r.count > 0)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((r) => r.customer.name.toLowerCase().includes(q))
    }

    if (sortBy === 'amount-desc') result.sort((a, b) => b.amount - a.amount)
    else if (sortBy === 'amount-asc') result.sort((a, b) => a.amount - b.amount)
    else if (sortBy === 'name-asc') result.sort((a, b) => a.customer.name.localeCompare(b.customer.name))
    else if (sortBy === 'last-contact') result.sort((a, b) => new Date(b.lastComm?.created_at ?? 0) - new Date(a.lastComm?.created_at ?? 0))

    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, tableInvoices, comms, customerFilter, sortBy, search, statusFilter])

  const totals = useMemo(() => {
    const invoiced = invoicesInPeriod.reduce((s, i) => s + i.amount, 0)
    const collected = invoicesInPeriod.reduce((s, i) => s + i.paid_amount, 0)
    return { invoiced, collected, pending: invoiced - collected }
  }, [invoicesInPeriod])

  const addComm = async ({ channel, tag, note }) => {
    setSaving(true)
    const { error: insertErr } = await supabase.from('ar_comms').insert({
      firm_id: firmId,
      customer_id: selectedCustomerId,
      channel, tag, note,
    })
    setSaving(false)
    if (insertErr) {
      alert(`Couldn't save that update: ${insertErr.message}`)
      return
    }
    await loadAll()
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  const handleExportCsv = () => {
    downloadCsv(
      'receivables-clients',
      ['Customer', isPaidView ? 'Paid Invoices' : 'Open Bills', isPaidView ? 'Amount Received' : 'Amount Due', 'Last Follow-up', 'Last Contact Date'],
      rows.map((r) => [
        r.customer.name,
        r.count,
        r.amount.toFixed(2),
        r.lastComm?.tag || 'No follow-up yet',
        r.lastComm ? new Date(r.lastComm.created_at).toLocaleDateString() : '',
      ])
    )
  }

  const handleExportPdf = () => {
    downloadListPdf({
      title: isPaidView ? 'Receivables — Paid Clients' : 'Receivables — Pending Clients',
      firm,
      filename: 'receivables-clients',
      columns: [
        { label: 'Customer' }, { label: isPaidView ? 'Paid Invoices' : 'Open Bills', align: 'right' },
        { label: isPaidView ? 'Amount Received' : 'Amount Due', align: 'right' },
        { label: 'Last Follow-up' }, { label: 'Last Contact' },
      ],
      rows: rows.map((r) => [
        r.customer.name,
        r.count,
        inr(r.amount),
        r.lastComm?.tag || 'No follow-up yet',
        r.lastComm ? new Date(r.lastComm.created_at).toLocaleDateString() : '—',
      ]),
    })
  }

  const handleExportWord = () => {
    downloadListDocx({
      title: isPaidView ? 'Receivables — Paid Clients' : 'Receivables — Pending Clients',
      firm,
      filename: 'receivables-clients',
      columns: [
        { label: 'Customer' }, { label: isPaidView ? 'Paid Invoices' : 'Open Bills', align: 'right' },
        { label: isPaidView ? 'Amount Received' : 'Amount Due', align: 'right' },
        { label: 'Last Follow-up' }, { label: 'Last Contact' },
      ],
      rows: rows.map((r) => [
        r.customer.name,
        r.count,
        inr(r.amount),
        r.lastComm?.tag || 'No follow-up yet',
        r.lastComm ? new Date(r.lastComm.created_at).toLocaleDateString() : '—',
      ]),
    })
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />

      <div className="grid-3">
        <StatCard label="Invoiced in period" value={inr(totals.invoiced)} />
        <StatCard label="Collected in period" value={inr(totals.collected)} accent />
        <StatCard label="Still pending" value={inr(totals.pending)} />
      </div>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search customer name...' }}
        filters={[
          {
            label: 'Customer', value: customerFilter, onChange: setCustomerFilter,
            options: [{ value: 'all', label: 'All' }, ...customers.map((c) => ({ value: c.id, label: c.name }))],
          },
          {
            label: 'Status', value: statusFilter, onChange: setStatusFilter,
            options: [{ value: 'all', label: 'All open' }, ...SALES_STATUSES.map((s) => ({ value: s, label: s }))],
          },
        ]}
        sort={{
          value: sortBy, onChange: setSortBy,
          options: [
            { value: 'amount-desc', label: `Amount ${isPaidView ? 'received' : 'due'}: high to low` },
            { value: 'amount-asc', label: `Amount ${isPaidView ? 'received' : 'due'}: low to high` },
            { value: 'last-contact', label: 'Last contact: most recent' },
            { value: 'name-asc', label: 'Customer name: A–Z' },
          ],
        }}
        exportOptions={{ onExcel: handleExportCsv, onPdf: handleExportPdf, onWord: handleExportWord, disabled: rows.length === 0 }}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>{isPaidView ? 'Paid clients' : 'Pending clients'}</h2>
          <span className="section-header__note">{rows.length} client{rows.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">{isPaidView ? 'Paid invoices' : 'Open bills'}</th>
              <SortableTh label={isPaidView ? 'Amount received' : 'Amount due'} ascValue="amount-asc" descValue="amount-desc" sortBy={sortBy} onSort={setSortBy} className="num" />
              <th>Last update</th>
              <th>Last contact</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer.id} className="ledger-row ledger-row--clickable" onClick={() => setSelectedCustomerId(r.customer.id)}>
                <td>{r.customer.name}</td>
                <td className="num mono">{r.count}</td>
                <td className="num mono">{inr(r.amount)}</td>
                <td>
                  {r.lastComm
                    ? <span className="comm-tag">{r.lastComm.tag}</span>
                    : <span className="pill pill--neutral">No follow-up yet</span>}
                </td>
                <td className="mono">{r.lastComm ? new Date(r.lastComm.created_at).toLocaleDateString() : '—'}</td>
                <td><button className="link-btn" onClick={(e) => { e.stopPropagation(); setSelectedCustomerId(r.customer.id) }}>View</button></td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={6}>No {isPaidView ? 'paid' : 'open'} receivables match these filters.</EmptyRow>}
          </tbody>
        </table>
        </div>
      </div>

      {selectedCustomer && (
        <CommDrawer
          customer={selectedCustomer}
          invoices={invoices}
          comms={comms.filter((c) => c.customer_id === selectedCustomer.id)}
          onAddComm={addComm}
          onClose={() => setSelectedCustomerId(null)}
          saving={saving}
        />
      )}
    </>
  )
}
