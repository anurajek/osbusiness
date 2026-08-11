import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, computeStatus, isResolved, MANUAL_STATUSES } from '../lib/format'
import { FilterBar } from '../components/FilterControls'
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

export default function ReceivablesScreen({ navParams, clearNavParams, onNavigate }) {
  const { firmId, firm } = useFirm()

  const [customers, setCustomers] = useState([])
  const [invoices, setInvoices] = useState([])
  const [pis, setPis] = useState([])
  const [comms, setComms] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
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

  // Arriving here from a click elsewhere (e.g. a customer's name in Sales)
  // pre-filters to that one customer, instead of landing on the full,
  // unfiltered list and making the person search for them again.
  useEffect(() => {
    if (navParams?.customerId) {
      setCustomerFilter(navParams.customerId)
      clearNavParams?.()
    }
  }, [navParams, clearNavParams])

  const loadAll = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)

    const [{ data: custRows, error: custErr }, { data: invRows, error: invErr }, { data: piRows, error: piErr }, { data: commRows, error: commErr }, { data: acctRows, error: acctErr }] = await Promise.all([
      supabase.from('customers').select('id, name').eq('firm_id', firmId).order('name'),
      supabase.from('sales_invoices').select('id, customer_id, invoice_no, issued_date, amount, paid_amount, status, is_cancelled, manual_status').eq('firm_id', firmId),
      supabase.from('proforma_invoices').select('id, customer_id, pi_no, issued_date, amount, paid_amount, is_cancelled, manual_status').eq('firm_id', firmId),
      supabase.from('ar_comms').select('id, customer_id, channel, tag, note, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }),
      supabase.from('bank_accounts').select('id, name, balance').eq('firm_id', firmId).order('name'),
    ])

    if (custErr || invErr || piErr || commErr || acctErr) {
      setError((custErr || invErr || piErr || commErr || acctErr).message)
      setLoading(false)
      return
    }
    setCustomers(custRows ?? [])
    setInvoices(invRows ?? [])
    setPis(piRows ?? [])
    setComms(commRows ?? [])
    setBankAccounts(acctRows ?? [])
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

  const pisInPeriod = useMemo(() => {
    if (!range) return pis
    return pis.filter((p) => {
      const d = new Date(p.issued_date)
      return d >= range.from && d <= range.to
    })
  }, [pis, range])

  const tableInvoices = useMemo(() => {
    if (statusFilter === 'all') return invoicesInPeriod.filter((i) => !isResolved(i))
    if (statusFilter === 'Paid') return invoicesInPeriod.filter((i) => !i.is_cancelled && Number(i.amount) - Number(i.paid_amount || 0) <= 0)
    return invoicesInPeriod.filter((i) => !i.is_cancelled && computeStatus(i, 'Sent') === statusFilter)
  }, [invoicesInPeriod, statusFilter])

  // Proforma Invoices don't carry the same Sent/Partial/Due today/Overdue
  // breakdown a Sales Invoice does (see migration_pi_and_reminders.sql -
  // "overdue" for a PI is a computed day-count on the PI Follow-up tab,
  // not a stored status), so they only participate in the general "All
  // open" and "Paid" views here - a granular status filter (Sent,
  // Overdue, etc.) is necessarily Invoice-only, and the UI says so.
  //
  // A PI cancelled, or manually tagged Paid/Invoiced/Completed, drops out
  // of both views entirely here - "Invoiced" specifically means a real Tax
  // Invoice now exists elsewhere for this same receivable, so it must stop
  // contributing to Receivables' totals or it would be double-counted
  // once that Tax Invoice is also imported. It's still fully visible and
  // actionable on PI Follow-up, which has its own status filter for
  // exactly this case - it just shouldn't keep counting here.
  const tablePis = useMemo(() => {
    if (statusFilter === 'all') return pisInPeriod.filter((p) => !isResolved(p))
    if (statusFilter === 'Paid') return pisInPeriod.filter((p) => !p.is_cancelled && Number(p.amount) - Number(p.paid_amount || 0) <= 0)
    return []
  }, [pisInPeriod, statusFilter])

  const lastCommFor = (customerId) => comms.find((c) => c.customer_id === customerId) || null

  const rows = useMemo(() => {
    let custList = customers
    if (customerFilter !== 'all') custList = custList.filter((c) => c.id === customerFilter)

    let result = custList.map((cust) => {
      // tableInvoices/tablePis are already correctly scoped for every
      // status branch above (including "all"), so no extra filtering
      // needed here - unlike the version before isResolved existed, which
      // had to re-exclude Paid by hand specifically for the "all" case.
      const relevantInvoices = tableInvoices.filter((i) => i.customer_id === cust.id)
      const relevantPis = tablePis.filter((p) => p.customer_id === cust.id)

      const invoiceAmount = isPaidView
        ? relevantInvoices.reduce((s, i) => s + i.paid_amount, 0)
        : relevantInvoices.reduce((s, i) => s + (i.amount - i.paid_amount), 0)
      const piAmount = isPaidView
        ? relevantPis.reduce((s, p) => s + Number(p.paid_amount || 0), 0)
        : relevantPis.reduce((s, p) => s + (Number(p.amount) - Number(p.paid_amount || 0)), 0)

      return {
        customer: cust,
        count: relevantInvoices.length + relevantPis.length,
        amount: invoiceAmount + piAmount,
        lastComm: lastCommFor(cust.id),
      }
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
  }, [customers, tableInvoices, tablePis, comms, customerFilter, sortBy, search, statusFilter])

  const totals = useMemo(() => {
    // Cancelled documents are void - excluded everywhere, same as
    // Payables already treats a cancelled bill. Manually-resolved ones
    // (Paid/Invoiced/Completed) still count toward what was genuinely
    // invoiced and collected - those are historical facts - but drop out
    // of "still pending" specifically, for the same double-counting
    // reason explained above tableInvoices/tablePis.
    const activeInvoices = invoicesInPeriod.filter((i) => !i.is_cancelled)
    const activePis = pisInPeriod.filter((p) => !p.is_cancelled)
    const invoiced = activeInvoices.reduce((s, i) => s + i.amount, 0) + activePis.reduce((s, p) => s + Number(p.amount), 0)
    const collected = activeInvoices.reduce((s, i) => s + i.paid_amount, 0) + activePis.reduce((s, p) => s + Number(p.paid_amount || 0), 0)
    const pending = activeInvoices.filter((i) => !isResolved(i)).reduce((s, i) => s + (i.amount - i.paid_amount), 0)
      + activePis.filter((p) => !isResolved(p)).reduce((s, p) => s + (Number(p.amount) - Number(p.paid_amount || 0)), 0)
    return { invoiced, collected, pending }
  }, [invoicesInPeriod, pisInPeriod])

  // Sets the manual status directly from the drawer's Bills table -
  // updates whichever table the document actually belongs to (docType is
  // set when building openDocs below). Since Invoice/PI Follow-up reads
  // from these exact same tables, this shows up there automatically on
  // next load - no separate sync mechanism, it's the same data either way.
  // "Cancelled" routes to the real is_cancelled toggle rather than writing
  // manual_status - see lib/format.js's comment on MANUAL_STATUSES for why
  // those stay two separate, non-overlapping mechanisms. Reinstating a
  // cancelled document isn't handled here on purpose: this Bills list only
  // ever shows currently-pending items (isResolved() already excludes
  // cancelled ones), so there's never a cancelled document to un-cancel
  // from this particular dropdown - that's what Invoice/PI Follow-up's own
  // Status column is for.
  const handleSetDocStatus = async (doc, value) => {
    const targetTable = doc.docType === 'pi' ? 'proforma_invoices' : 'sales_invoices'
    if (value === 'Cancelled') {
      if (!window.confirm(`Cancel ${doc.number}? It'll stop counting toward what's owed, but stays on record.`)) return
      const { error: err } = await supabase.from(targetTable).update({ is_cancelled: true }).eq('id', doc.id)
      if (err) { alert(`Couldn't update that: ${err.message}`); return }
      await loadAll()
      return
    }
    const { error: err } = await supabase.from(targetTable).update({ manual_status: value || null }).eq('id', doc.id)
    if (err) { alert(`Couldn't update status: ${err.message}`); return }
    await loadAll()
  }

  // Real payment recording from the drawer's inline mini-form - same shape
  // as PaymentFollowUpScreen.jsx's version (a genuine bank_transactions
  // row, the account balance updated, paid_amount bumped rather than
  // overwritten), just PI-aware here via doc.docType since this same
  // drawer's Bills list mixes Invoices and PIs together. Returns
  // {ok, error} rather than throwing/alerting directly, since CommDrawer
  // itself owns showing the error inline in its mini-form.
  const handleRecordPaymentFromDrawer = async (doc, { amount, bankAccountId, date, status }) => {
    const targetTable = doc.docType === 'pi' ? 'proforma_invoices' : 'sales_invoices'
    const account = bankAccounts.find((a) => a.id === bankAccountId)
    if (!account) return { ok: false, error: 'That account could not be found - try reopening this form.' }

    const sourceRows = doc.docType === 'pi' ? pis : invoices
    const sourceDoc = sourceRows.find((r) => r.id === doc.id)
    const currentPaid = Number(sourceDoc?.paid_amount || 0)
    const newPaid = Math.min(currentPaid + amount, Number(sourceDoc?.amount ?? doc.amountDue + currentPaid))

    const { error: docErr } = await supabase.from(targetTable)
      .update({ paid_amount: newPaid, manual_status: status, is_cancelled: false })
      .eq('id', doc.id)
    if (docErr) return { ok: false, error: docErr.message }

    const { error: txnErr } = await supabase.from('bank_transactions').insert({
      firm_id: firmId,
      bank_account_id: bankAccountId,
      txn_date: date,
      description: `Payment received — ${doc.number} (${customers.find((c) => c.id === selectedCustomerId)?.name || ''})`,
      amount,
      reconciled: true,
      related_sales_invoice_id: doc.docType === 'pi' ? null : doc.id,
      related_proforma_invoice_id: doc.docType === 'pi' ? doc.id : null,
    })
    if (txnErr) {
      await loadAll()
      return { ok: false, error: `Status was updated, but recording the ${account.name} transaction failed: ${txnErr.message}. Check Cash & Bank and add it manually if needed.` }
    }

    const { error: acctErr } = await supabase.from('bank_accounts').update({ balance: Number(account.balance) + amount }).eq('id', bankAccountId)
    if (acctErr) {
      await loadAll()
      return { ok: false, error: `Status was updated, but the ${account.name} balance couldn't be updated: ${acctErr.message}.` }
    }

    await loadAll()
    return { ok: true }
  }

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
      ['Customer', isPaidView ? 'Paid Items' : 'Open Items', isPaidView ? 'Amount Received' : 'Amount Due', 'Last Follow-up', 'Last Contact Date'],
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
        { label: 'Customer' }, { label: isPaidView ? 'Paid Items' : 'Open Items', align: 'right' },
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
        { label: 'Customer' }, { label: isPaidView ? 'Paid Items' : 'Open Items', align: 'right' },
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
        period={{ value: period, onChange: setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }}
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

      {statusFilter !== 'all' && statusFilter !== 'Paid' && (
        <p className="login-footnote" style={{ marginTop: -8 }}>
          "{statusFilter}" is an Invoice-only status — Proforma Invoices don't have that breakdown, so they're not included in this specific view. Switch to "All open" to see both together.
        </p>
      )}

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>{isPaidView ? 'Paid clients' : 'Pending clients'}</h2>
          <span className="section-header__note">{rows.length} client{rows.length !== 1 ? 's' : ''}{statusFilter === 'all' || statusFilter === 'Paid' ? ' · invoices + proforma invoices combined' : ''}</span>
        </div>
        <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">{isPaidView ? 'Paid items' : 'Open items'}</th>
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
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    className="select select--sm"
                    value=""
                    onChange={(e) => {
                      const action = e.target.value
                      if (action === 'view') setSelectedCustomerId(r.customer.id)
                      else if (action === 'invoice-followup') onNavigate?.('arap', 'invoice-followup', { customerId: r.customer.id })
                      else if (action === 'pi-followup') onNavigate?.('arap', 'pi-followup', { customerId: r.customer.id })
                    }}
                  >
                    <option value="" disabled>Actions…</option>
                    <option value="view">View details</option>
                    {onNavigate && <option value="invoice-followup">Invoice Follow-up →</option>}
                    {onNavigate && <option value="pi-followup">PI Follow-up →</option>}
                  </select>
                </td>
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
          docLabel="Document"
          openDocs={[
            ...invoices
              .filter((i) => i.customer_id === selectedCustomer.id && !isResolved(i))
              .map((i) => ({ id: i.id, number: i.invoice_no, issued_date: i.issued_date, amountDue: i.amount - i.paid_amount, statusLabel: computeStatus(i, 'Sent'), manualStatus: i.manual_status, docType: 'invoice' })),
            ...pis
              .filter((p) => p.customer_id === selectedCustomer.id && !isResolved(p))
              .map((p) => ({ id: p.id, number: p.pi_no, issued_date: p.issued_date, amountDue: p.amount - p.paid_amount, statusLabel: 'Proforma', manualStatus: p.manual_status, docType: 'pi' })),
          ]}
          comms={comms.filter((c) => c.customer_id === selectedCustomer.id)}
          onAddComm={addComm}
          onClose={() => setSelectedCustomerId(null)}
          saving={saving}
          onSetStatus={handleSetDocStatus}
          onRecordPayment={handleRecordPaymentFromDrawer}
          bankAccounts={bankAccounts}
          manualStatusOptions={[...MANUAL_STATUSES, 'Cancelled']}
          links={onNavigate ? [
            { label: 'Invoice Follow-up →', onClick: () => onNavigate('arap', 'invoice-followup', { customerId: selectedCustomer.id }) },
            { label: 'PI Follow-up →', onClick: () => onNavigate('arap', 'pi-followup', { customerId: selectedCustomer.id }) },
          ] : undefined}
        />
      )}
    </>
  )
}
