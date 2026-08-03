import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, computeStatus } from '../lib/format'
import { PeriodSelector, FilterBar } from '../components/FilterControls'
import { StatCard, EmptyRow, SortableTh } from '../components/ui'
import CommDrawer from '../components/CommDrawer'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf } from '../lib/pdf'

const SALES_STATUSES_OPEN = ['Sent', 'Partial', 'Due today', 'Overdue']

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
  const [paymentTxns, setPaymentTxns] = useState([])

  const loadAll = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)

    const [{ data: custRows, error: custErr }, { data: invRows, error: invErr }, { data: commRows, error: commErr }, { data: txnRows, error: txnErr }] = await Promise.all([
      supabase.from('customers').select('id, name').eq('firm_id', firmId).order('name'),
      supabase.from('sales_invoices').select('id, customer_id, invoice_no, issued_date, amount, paid_amount, status').eq('firm_id', firmId),
      supabase.from('ar_comms').select('id, customer_id, channel, tag, note, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }),
      supabase.from('bank_transactions').select('id, related_sales_invoice_id, txn_date, amount').eq('firm_id', firmId).not('related_sales_invoice_id', 'is', null),
    ])

    if (custErr || invErr || commErr || txnErr) {
      setError((custErr || invErr || commErr || txnErr).message)
      setLoading(false)
      return
    }
    setCustomers(custRows ?? [])
    setInvoices(invRows ?? [])
    setComms(commRows ?? [])
    setPaymentTxns(txnRows ?? [])
    setLoading(false)
  }, [firmId])

  useEffect(() => { loadAll() }, [loadAll])

  const range = getPeriodRange(period, customFrom, customTo)

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
      const openInvoices = custInvoices.filter((i) => computeStatus(i, 'Sent') !== 'Paid')
      const amountDue = openInvoices.reduce((s, i) => s + (i.amount - i.paid_amount), 0)
      return { customer: cust, openCount: openInvoices.length, amountDue, lastComm: lastCommFor(cust.id) }
    }).filter((r) => r.amountDue > 0)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((r) => r.customer.name.toLowerCase().includes(q))
    }

    if (sortBy === 'amount-desc') result.sort((a, b) => b.amountDue - a.amountDue)
    else if (sortBy === 'amount-asc') result.sort((a, b) => a.amountDue - b.amountDue)
    else if (sortBy === 'name-asc') result.sort((a, b) => a.customer.name.localeCompare(b.customer.name))
    else if (sortBy === 'last-contact') result.sort((a, b) => new Date(b.lastComm?.created_at ?? 0) - new Date(a.lastComm?.created_at ?? 0))

    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, tableInvoices, comms, customerFilter, sortBy, search])

  // Every actual payment received - one row per Record Payment event, not
  // filtered down to invoices that happen to be fully settled. A customer
  // who's paid ₹500 of a ₹2,000 invoice absolutely counts as "who paid,
  // when, how much" even though that invoice is still Partial.
  const paymentsReceived = useMemo(() => {
    let list = paymentTxns
    if (range) list = list.filter((t) => { const d = new Date(t.txn_date); return d >= range.from && d <= range.to })
    list = list
      .map((t) => {
        const inv = invoices.find((i) => i.id === t.related_sales_invoice_id)
        return { ...t, invoice_no: inv?.invoice_no || '—', customer_id: inv?.customer_id || null }
      })
      .filter((t) => t.customer_id)
    if (customerFilter !== 'all') list = list.filter((t) => t.customer_id === customerFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((t) => (customers.find((c) => c.id === t.customer_id)?.name || '').toLowerCase().includes(q))
    }
    return list.sort((a, b) => new Date(b.txn_date) - new Date(a.txn_date))
  }, [paymentTxns, range, invoices, customerFilter, search, customers])

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
      'receivables-pending-clients',
      ['Customer', 'Open Bills', 'Amount Due', 'Last Follow-up', 'Last Contact Date'],
      rows.map((r) => [
        r.customer.name,
        r.openCount,
        r.amountDue.toFixed(2),
        r.lastComm?.tag || 'No follow-up yet',
        r.lastComm ? new Date(r.lastComm.created_at).toLocaleDateString() : '',
      ])
    )
  }

  const handleExportPdf = () => {
    downloadListPdf({
      title: 'Receivables — Pending Clients',
      firm,
      filename: 'receivables-pending-clients',
      columns: [
        { label: 'Customer' }, { label: 'Open Bills', align: 'right' }, { label: 'Amount Due', align: 'right' },
        { label: 'Last Follow-up' }, { label: 'Last Contact' },
      ],
      rows: rows.map((r) => [
        r.customer.name,
        r.openCount,
        inr(r.amountDue),
        r.lastComm?.tag || 'No follow-up yet',
        r.lastComm ? new Date(r.lastComm.created_at).toLocaleDateString() : '—',
      ]),
    })
  }

  const customerName = (id) => customers.find((c) => c.id === id)?.name || '—'

  const handleExportReceivedCsv = () => {
    downloadCsv(
      'receivables-payments-received',
      ['Payment Date', 'Customer', 'Invoice #', 'Amount Received'],
      paymentsReceived.map((t) => [t.txn_date, customerName(t.customer_id), t.invoice_no, Number(t.amount).toFixed(2)])
    )
  }

  const handleExportReceivedPdf = () => {
    downloadListPdf({
      title: 'Receivables — Payments Received',
      firm,
      filename: 'receivables-payments-received',
      columns: [
        { label: 'Payment Date' }, { label: 'Customer' }, { label: 'Invoice #' }, { label: 'Amount Received', align: 'right' },
      ],
      rows: paymentsReceived.map((t) => [t.txn_date, customerName(t.customer_id), t.invoice_no, inr(t.amount)]),
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
            options: [{ value: 'all', label: 'All open' }, ...SALES_STATUSES_OPEN.map((s) => ({ value: s, label: s }))],
          },
        ]}
        sort={{
          value: sortBy, onChange: setSortBy,
          options: [
            { value: 'amount-desc', label: 'Amount due: high to low' },
            { value: 'amount-asc', label: 'Amount due: low to high' },
            { value: 'last-contact', label: 'Last contact: most recent' },
            { value: 'name-asc', label: 'Customer name: A–Z' },
          ],
        }}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>Pending clients</h2>
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="section-header__note">{rows.length} client{rows.length !== 1 ? 's' : ''} with open bills</span>
            <button className="link-btn" onClick={handleExportCsv} disabled={rows.length === 0}>Export CSV</button>
            <button className="link-btn" onClick={handleExportPdf} disabled={rows.length === 0}>Export PDF</button>
          </span>
        </div>
        <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">Open bills</th>
              <SortableTh label="Amount due" ascValue="amount-asc" descValue="amount-desc" sortBy={sortBy} onSort={setSortBy} className="num" />
              <th>Last update</th>
              <th>Last contact</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer.id} className="ledger-row ledger-row--clickable" onClick={() => setSelectedCustomerId(r.customer.id)}>
                <td>{r.customer.name}</td>
                <td className="num mono">{r.openCount}</td>
                <td className="num mono">{inr(r.amountDue)}</td>
                <td>
                  {r.lastComm
                    ? <span className="comm-tag">{r.lastComm.tag}</span>
                    : <span className="pill pill--neutral">No follow-up yet</span>}
                </td>
                <td className="mono">{r.lastComm ? new Date(r.lastComm.created_at).toLocaleDateString() : '—'}</td>
                <td><button className="link-btn" onClick={(e) => { e.stopPropagation(); setSelectedCustomerId(r.customer.id) }}>View</button></td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={6}>No open receivables match these filters.</EmptyRow>}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>Payments Received</h2>
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="section-header__note">{paymentsReceived.length} payment{paymentsReceived.length !== 1 ? 's' : ''} in this period</span>
            <button className="link-btn" onClick={handleExportReceivedCsv} disabled={paymentsReceived.length === 0}>Export CSV</button>
            <button className="link-btn" onClick={handleExportReceivedPdf} disabled={paymentsReceived.length === 0}>Export PDF</button>
          </span>
        </div>
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr><th>Payment Date</th><th>Customer</th><th>Invoice</th><th className="num">Amount Received</th></tr>
            </thead>
            <tbody>
              {paymentsReceived.map((t) => (
                <tr key={t.id} className="ledger-row">
                  <td className="mono">{t.txn_date}</td>
                  <td>{customerName(t.customer_id)}</td>
                  <td className="mono">{t.invoice_no}</td>
                  <td className="num mono">{inr(t.amount)}</td>
                </tr>
              ))}
              {paymentsReceived.length === 0 && <EmptyRow colSpan={4}>No payments recorded in this period.</EmptyRow>}
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
