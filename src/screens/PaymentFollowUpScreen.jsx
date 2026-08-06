import { useCallback, useEffect, useState, Fragment } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, toISODate, getPeriodRange } from '../lib/format'
import { PeriodSelector, FilterBar } from '../components/FilterControls'
import { SectionHeader, EmptyRow, StatCard } from '../components/ui'
import CommDrawer from '../components/CommDrawer'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf, previewDocumentPdf, itemTaxFieldsFromRow } from '../lib/pdf'
import { downloadListDocx } from '../lib/exportDocx'
import PdfPreviewModal from '../components/PdfPreviewModal'

const STAGE_LABEL = { gentle: 'Gentle nudge', reminder: 'Reminder', due: 'Due notice', overdue: 'Overdue notice' }
const MANUAL_STATUSES = ['Sent', 'Overdue', 'Paid', 'Invoiced', 'Completed']

export default function PaymentFollowUpScreen({ docType }) {
  const { firmId, firm } = useFirm()
  const isPi = docType === 'pi'
  const table = isPi ? 'proforma_invoices' : 'sales_invoices'
  const numberField = isPi ? 'pi_no' : 'invoice_no'
  const docLabel = isPi ? 'Proforma Invoice' : 'Invoice'
  const graceDays = firm?.reminder_grace_days ?? 7

  const [docs, setDocs] = useState([])
  const [customers, setCustomers] = useState([])
  const [comms, setComms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('overdue-desc')
  const [statusFilter, setStatusFilter] = useState('all')

  const [expandedId, setExpandedId] = useState(null)
  const [emailsByCustomer, setEmailsByCustomer] = useState({})
  const [newEmail, setNewEmail] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [actionMsg, setActionMsg] = useState({})
  const [preview, setPreview] = useState(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [{ data: docRows, error: docErr }, { data: custs, error: custErr }, { data: commRows, error: commErr }] = await Promise.all([
      supabase.from(table)
        .select(`id, customer_id, ${numberField}, issued_date, amount, paid_amount, reminders_paused, last_reminder_stage, last_reminder_sent_date, manual_status, item_description, item_quantity, item_rate, subtotal, discount_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount`)
        .eq('firm_id', firmId).order('issued_date', { ascending: false }),
      supabase.from('customers').select('id, name, email, address, gstin').eq('firm_id', firmId),
      supabase.from('ar_comms').select('id, customer_id, channel, tag, note, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }),
    ])
    if (docErr || custErr || commErr) { setError((docErr || custErr || commErr).message); setLoading(false); return }
    setDocs(docRows ?? [])
    setCustomers(custs ?? [])
    setComms(commRows ?? [])
    setLoading(false)
  }, [firmId, table, numberField])

  useEffect(() => { load() }, [load])

  const customerName = (id) => customers.find((c) => c.id === id)?.name || '—'
  const daysSinceIssued = (issuedDate) => Math.floor((Date.now() - new Date(issuedDate + 'T00:00:00').getTime()) / 86400000)
  const daysOverdue = (issuedDate) => Math.max(0, daysSinceIssued(issuedDate) - graceDays)

  const range = getPeriodRange(period, customFrom, customTo)

  const docsInPeriod = range
    ? docs.filter((d) => { const dt = new Date(d.issued_date); return dt >= range.from && dt <= range.to })
    : docs

  const totals = docsInPeriod.reduce((acc, d) => {
    acc.invoiced += Number(d.amount)
    acc.collected += Number(d.paid_amount || 0)
    return acc
  }, { invoiced: 0, collected: 0 })
  totals.pending = totals.invoiced - totals.collected

  const pending = docsInPeriod.filter((d) => Number(d.amount) - Number(d.paid_amount || 0) > 0)

  // "All" (the default) is the amount-based pending list, exactly as
  // before - most people never touch manual_status, so that stays the
  // common case. Picking a specific manual status searches the whole
  // period instead, since a document manually tagged "Paid" or
  // "Completed" may well have already dropped out of the pending set.
  const baseRows = statusFilter === 'all' ? pending : docsInPeriod.filter((d) => d.manual_status === statusFilter)

  const filtered = baseRows
    .filter((r) => !search.trim() || customerName(r.customer_id).toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'overdue-desc') return daysOverdue(b.issued_date) - daysOverdue(a.issued_date)
      if (sortBy === 'amount-desc') return (b.amount - b.paid_amount) - (a.amount - a.paid_amount)
      return new Date(b.issued_date) - new Date(a.issued_date)
    })

  const handleSetManualStatus = async (row, value) => {
    const { error: err } = await supabase.from(table).update({ manual_status: value || null }).eq('id', row.id)
    if (err) { alert(`Couldn't update status: ${err.message}`); return }
    load()
  }

  const loadEmails = async (customerId) => {
    if (emailsByCustomer[customerId]) return
    const { data } = await supabase.from('customer_reminder_emails').select('id, email').eq('customer_id', customerId)
    setEmailsByCustomer((prev) => ({ ...prev, [customerId]: data ?? [] }))
  }

  const toggleExpand = (row) => {
    if (expandedId === row.id) { setExpandedId(null); return }
    setExpandedId(row.id)
    loadEmails(row.customer_id)
  }

  const handleAddEmail = async (customerId) => {
    if (!newEmail.trim()) return
    const { error: err } = await supabase.from('customer_reminder_emails').insert({ customer_id: customerId, email: newEmail.trim() })
    if (err) { alert(`Couldn't add that email: ${err.message}`); return }
    setNewEmail('')
    setEmailsByCustomer((prev) => { const next = { ...prev }; delete next[customerId]; return next })
    loadEmails(customerId)
  }

  const handleRemoveEmail = async (customerId, emailId) => {
    await supabase.from('customer_reminder_emails').delete().eq('id', emailId)
    setEmailsByCustomer((prev) => { const next = { ...prev }; delete next[customerId]; return next })
    loadEmails(customerId)
  }

  const handleTogglePause = async (row) => {
    setBusyId(row.id)
    const { error: err } = await supabase.from(table).update({ reminders_paused: !row.reminders_paused }).eq('id', row.id)
    setBusyId(null)
    if (err) { alert(`Couldn't update that: ${err.message}`); return }
    load()
  }

  const handleSendNow = async (row) => {
    setBusyId(row.id)
    setActionMsg((prev) => ({ ...prev, [row.id]: null }))
    const { data, error: err } = await supabase.functions.invoke('send-payment-reminder', {
      body: { documentType: isPi ? 'proforma_invoice' : 'invoice', documentId: row.id },
    })
    setBusyId(null)
    if (err) {
      let message = err.message
      try {
        if (err.context) {
          const body = await err.context.json()
          if (body?.error) message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error)
        }
      } catch { /* fall back to err.message */ }
      setActionMsg((prev) => ({ ...prev, [row.id]: { type: 'error', text: message } }))
      return
    }
    setActionMsg((prev) => ({ ...prev, [row.id]: { type: 'ok', text: `Sent a "${STAGE_LABEL[data.stage] || data.stage}" to ${data.sentTo.join(', ')}` } }))
    load()
  }

  const handlePreview = async (row) => {
    const party = customers.find((c) => c.id === row.customer_id) || null
    const { url, filename } = await previewDocumentPdf({
      firm: firm || {},
      party,
      doc: {
        number: row[numberField],
        issued_date: row.issued_date,
        due_date: null,
        amount: row.amount,
        paid_amount: row.paid_amount,
        status: (Number(row.amount) - Number(row.paid_amount || 0)) <= 0 ? 'Paid' : 'Sent',
        isSales: true,
        docTypeLabel: isPi ? 'PROFORMA INVOICE' : undefined,
        ...itemTaxFieldsFromRow(row),
      },
    })
    setPreview({ url, filename })
  }

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  const handleAction = (row, action) => {
    if (action === 'preview') handlePreview(row)
    else if (action === 'send') handleSendNow(row)
    else if (action === 'pause') handleTogglePause(row)
    else if (action === 'update') setSelectedCustomerId(row.customer_id)
  }

  const addComm = async ({ channel, tag, note }) => {
    setSaving(true)
    const { error: insertErr } = await supabase.from('ar_comms').insert({ firm_id: firmId, customer_id: selectedCustomerId, channel, tag, note })
    setSaving(false)
    if (insertErr) { alert(`Couldn't save that update: ${insertErr.message}`); return }
    await load()
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  const exportRows = filtered.map((r) => [
    customerName(r.customer_id), r[numberField], r.issued_date,
    inr(r.amount - r.paid_amount), daysOverdue(r.issued_date), r.manual_status || '—',
    r.last_reminder_sent_date ? `${STAGE_LABEL[r.last_reminder_stage] || r.last_reminder_stage} on ${r.last_reminder_sent_date}` : 'Never',
    r.reminders_paused ? 'Paused' : 'Active',
  ])
  const exportColumns = ['Customer', docLabel + ' #', 'Issued', 'Amount Pending', 'Days Overdue', 'Status', 'Last Reminder', 'Reminders']

  const handleExportCsv = () => downloadCsv(`${docType}-followup`, exportColumns, exportRows)
  const handleExportPdf = () => downloadListPdf({ title: `${docLabel} Follow-up`, firm, filename: `${docType}-followup`, columns: exportColumns.map((c) => ({ label: c })), rows: exportRows })
  const handleExportWord = () => downloadListDocx({ title: `${docLabel} Follow-up`, firm, filename: `${docType}-followup`, columns: exportColumns.map((c) => ({ label: c })), rows: exportRows })

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title={`${docLabel} Follow-up`} note={`pending ${docLabel.toLowerCase()}s, days overdue, and reminder status`} />

      <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />

      <div className="grid-3">
        <StatCard label={`${docLabel}s in period`} value={inr(totals.invoiced)} />
        <StatCard label="Collected in period" value={inr(totals.collected)} accent />
        <StatCard label="Still pending" value={inr(totals.pending)} />
      </div>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search customer name...' }}
        filters={[
          {
            label: 'Status', value: statusFilter, onChange: setStatusFilter,
            options: [{ value: 'all', label: 'Pending (default)' }, ...MANUAL_STATUSES.map((s) => ({ value: s, label: s }))],
          },
        ]}
        sort={{ value: sortBy, onChange: setSortBy, options: [
          { value: 'overdue-desc', label: 'Most overdue first' },
          { value: 'amount-desc', label: 'Amount pending: high to low' },
          { value: 'date-desc', label: 'Newest issued first' },
        ] }}
        exportOptions={{ onExcel: handleExportCsv, onPdf: handleExportPdf, onWord: handleExportWord, disabled: filtered.length === 0 }}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>{statusFilter === 'all' ? `Pending ${docLabel.toLowerCase()}s` : `${statusFilter} ${docLabel.toLowerCase()}s`}</h2>
          <span className="section-header__note">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Customer</th><th>{docLabel} #</th><th>Issued</th>
                <th className="num">Amount Pending</th><th className="num">Days Overdue</th>
                <th>Status</th><th>Last Reminder</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const overdue = daysOverdue(r.issued_date)
                const busy = busyId === r.id
                const msg = actionMsg[r.id]
                return (
                  <Fragment key={r.id}>
                    <tr className="ledger-row" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(r)}>
                      <td>{customerName(r.customer_id)}</td>
                      <td className="mono">{r[numberField]}</td>
                      <td className="mono">{toISODate(new Date(r.issued_date))}</td>
                      <td className="num mono">{inr(r.amount - r.paid_amount)}</td>
                      <td className="num mono" style={{ color: overdue > 0 ? 'var(--brick)' : 'inherit' }}>{overdue > 0 ? overdue : '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className="select select--sm"
                          value={r.manual_status || ''}
                          onChange={(e) => handleSetManualStatus(r, e.target.value)}
                        >
                          <option value="">—</option>
                          {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        {r.last_reminder_sent_date
                          ? <span className="login-footnote" style={{ margin: 0 }}>{STAGE_LABEL[r.last_reminder_stage] || r.last_reminder_stage} · {r.last_reminder_sent_date}</span>
                          : <span className="pill pill--neutral">Never sent</span>}
                        {r.reminders_paused && <span className="pill pill--warn" style={{ marginLeft: 6 }}>Paused</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className="select select--sm"
                          value=""
                          disabled={busy}
                          onChange={(e) => { const action = e.target.value; if (action) handleAction(r, action) }}
                        >
                          <option value="" disabled>{busy ? 'Working…' : 'Actions…'}</option>
                          <option value="preview">Preview</option>
                          <option value="send" disabled={r.reminders_paused}>Send reminder now</option>
                          <option value="pause">{r.reminders_paused ? 'Resume reminders' : 'Pause reminders'}</option>
                          <option value="update">Log an update</option>
                        </select>
                      </td>
                    </tr>
                    {msg && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0 12px 8px', color: msg.type === 'ok' ? 'var(--teal)' : 'var(--brick)', fontSize: '12.5px' }}>
                          {msg.text}
                        </td>
                      </tr>
                    )}
                    {expandedId === r.id && (
                      <tr>
                        <td colSpan={8} style={{ padding: 12, background: 'var(--panel-alt)' }}>
                          <div className="login-footnote" style={{ margin: '0 0 8px', textTransform: 'uppercase', fontSize: 11 }}>
                            Reminder emails for {customerName(r.customer_id)}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                            {(emailsByCustomer[r.customer_id] ?? []).map((e) => (
                              <span key={e.id} className="pill pill--neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {e.email}
                                <button className="link-btn" style={{ padding: 0, color: 'var(--brick)' }} onClick={() => handleRemoveEmail(r.customer_id, e.id)}>×</button>
                              </span>
                            ))}
                            {(emailsByCustomer[r.customer_id]?.length ?? 0) === 0 && (
                              <span className="login-footnote" style={{ margin: 0 }}>
                                No reminder emails added yet — falls back to {customers.find((c) => c.id === r.customer_id)?.email || 'the customer\'s main email, if set'}.
                              </span>
                            )}
                          </div>
                          <div className="add-comm-row" style={{ maxWidth: 420 }}>
                            <input className="text-input" type="email" placeholder="Add an email address" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                            <button type="button" className="btn-primary" onClick={() => handleAddEmail(r.customer_id)}>Add</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {filtered.length === 0 && <EmptyRow colSpan={8}>No {docLabel.toLowerCase()}s match these filters.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>

      {preview && <PdfPreviewModal url={preview.url} filename={preview.filename} onClose={closePreview} />}

      {selectedCustomer && (
        <CommDrawer
          customer={selectedCustomer}
          docLabel={docLabel}
          openDocs={pending
            .filter((d) => d.customer_id === selectedCustomer.id)
            .map((d) => ({
              id: d.id, number: d[numberField], issued_date: d.issued_date,
              amountDue: d.amount - d.paid_amount,
              statusLabel: daysOverdue(d.issued_date) > 0 ? 'Overdue' : 'Sent',
            }))}
          comms={comms.filter((c) => c.customer_id === selectedCustomer.id)}
          onAddComm={addComm}
          onClose={() => setSelectedCustomerId(null)}
          saving={saving}
        />
      )}
    </>
  )
}
