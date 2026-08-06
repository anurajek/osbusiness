import { useCallback, useEffect, useState, Fragment } from 'react'
import { Send, PauseCircle, PlayCircle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, toISODate } from '../lib/format'
import { PeriodSelector, FilterBar } from '../components/FilterControls'
import { SectionHeader, EmptyRow } from '../components/ui'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf } from '../lib/pdf'
import { downloadListDocx } from '../lib/exportDocx'

const STAGE_LABEL = { gentle: 'Gentle nudge', reminder: 'Reminder', due: 'Due notice', overdue: 'Overdue notice' }

export default function PaymentFollowUpScreen({ docType }) {
  const { firmId, firm } = useFirm()
  const isPi = docType === 'pi'
  const table = isPi ? 'proforma_invoices' : 'sales_invoices'
  const numberField = isPi ? 'pi_no' : 'invoice_no'
  const docLabel = isPi ? 'Proforma Invoice' : 'Invoice'
  const graceDays = firm?.reminder_grace_days ?? 7

  const [rows, setRows] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('overdue-desc')

  const [expandedId, setExpandedId] = useState(null)
  const [emailsByCustomer, setEmailsByCustomer] = useState({})
  const [newEmail, setNewEmail] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [actionMsg, setActionMsg] = useState({})

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [{ data: docs, error: docErr }, { data: custs, error: custErr }] = await Promise.all([
      supabase.from(table)
        .select(`id, customer_id, ${numberField}, issued_date, amount, paid_amount, reminders_paused, last_reminder_stage, last_reminder_sent_date`)
        .eq('firm_id', firmId).order('issued_date', { ascending: false }),
      supabase.from('customers').select('id, name, email').eq('firm_id', firmId),
    ])
    if (docErr || custErr) { setError((docErr || custErr).message); setLoading(false); return }
    setRows((docs ?? []).filter((d) => Number(d.amount) - Number(d.paid_amount || 0) > 0))
    setCustomers(custs ?? [])
    setLoading(false)
  }, [firmId, table, numberField])

  useEffect(() => { load() }, [load])

  const customerName = (id) => customers.find((c) => c.id === id)?.name || '—'
  const daysSinceIssued = (issuedDate) => Math.floor((Date.now() - new Date(issuedDate + 'T00:00:00').getTime()) / 86400000)
  const daysOverdue = (issuedDate) => Math.max(0, daysSinceIssued(issuedDate) - graceDays)

  const range = (() => {
    if (period === 'All time') return null
    if (period === 'Custom') return customFrom && customTo ? { from: new Date(customFrom), to: new Date(customTo) } : null
    const now = new Date()
    const from = new Date(now)
    if (period === 'Last month') from.setMonth(from.getMonth() - 1)
    else if (period === 'Last quarter') from.setMonth(from.getMonth() - 3)
    else if (period === 'Last year') from.setFullYear(from.getFullYear() - 1)
    return { from, to: now }
  })()

  const filtered = rows
    .filter((r) => !range || (new Date(r.issued_date) >= range.from && new Date(r.issued_date) <= range.to))
    .filter((r) => !search.trim() || customerName(r.customer_id).toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'overdue-desc') return daysOverdue(b.issued_date) - daysOverdue(a.issued_date)
      if (sortBy === 'amount-desc') return (b.amount - b.paid_amount) - (a.amount - a.paid_amount)
      return new Date(b.issued_date) - new Date(a.issued_date)
    })

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
      // Try to pull the function's own specific error message out of the
      // failed response, rather than showing supabase-js's generic
      // "Edge Function returned a non-2xx status code" wrapper - same fix
      // already applied to the invite-email flow, for the same reason.
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

  const exportRows = filtered.map((r) => [
    customerName(r.customer_id), r[numberField], r.issued_date,
    inr(r.amount - r.paid_amount), daysOverdue(r.issued_date),
    r.last_reminder_sent_date ? `${STAGE_LABEL[r.last_reminder_stage] || r.last_reminder_stage} on ${r.last_reminder_sent_date}` : 'Never',
    r.reminders_paused ? 'Paused' : 'Active',
  ])
  const exportColumns = ['Customer', docLabel + ' #', 'Issued', 'Amount Pending', 'Days Overdue', 'Last Reminder', 'Reminders']

  const handleExportCsv = () => downloadCsv(`${docType}-followup`, exportColumns, exportRows)
  const handleExportPdf = () => downloadListPdf({ title: `${docLabel} Follow-up`, firm, filename: `${docType}-followup`, columns: exportColumns.map((c) => ({ label: c })), rows: exportRows })
  const handleExportWord = () => downloadListDocx({ title: `${docLabel} Follow-up`, firm, filename: `${docType}-followup`, columns: exportColumns.map((c) => ({ label: c })), rows: exportRows })

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title={`${docLabel} Follow-up`} note={`pending ${docLabel.toLowerCase()}s, days overdue, and reminder status`} />

      <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search customer name...' }}
        filters={[]}
        sort={{ value: sortBy, onChange: setSortBy, options: [
          { value: 'overdue-desc', label: 'Most overdue first' },
          { value: 'amount-desc', label: 'Amount pending: high to low' },
          { value: 'date-desc', label: 'Newest issued first' },
        ] }}
        exportOptions={{ onExcel: handleExportCsv, onPdf: handleExportPdf, onWord: handleExportWord, disabled: filtered.length === 0 }}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>Pending {docLabel.toLowerCase()}s</h2>
          <span className="section-header__note">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Customer</th><th>{docLabel} #</th><th>Issued</th>
                <th className="num">Amount Pending</th><th className="num">Days Overdue</th>
                <th>Last Reminder</th><th></th>
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
                      <td>
                        {r.last_reminder_sent_date
                          ? <span className="login-footnote" style={{ margin: 0 }}>{STAGE_LABEL[r.last_reminder_stage] || r.last_reminder_stage} · {r.last_reminder_sent_date}</span>
                          : <span className="pill pill--neutral">Never sent</span>}
                        {r.reminders_paused && <span className="pill pill--warn" style={{ marginLeft: 6 }}>Paused</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        <button className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} disabled={busy || r.reminders_paused} onClick={() => handleSendNow(r)}>
                          <Send size={12} /> Send now
                        </button>
                        <button className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} disabled={busy} onClick={() => handleTogglePause(r)}>
                          {r.reminders_paused ? <><PlayCircle size={12} /> Resume</> : <><PauseCircle size={12} /> Pause</>}
                        </button>
                      </td>
                    </tr>
                    {msg && (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 12px 8px', color: msg.type === 'ok' ? 'var(--teal)' : 'var(--brick)', fontSize: '12.5px' }}>
                          {msg.text}
                        </td>
                      </tr>
                    )}
                    {expandedId === r.id && (
                      <tr>
                        <td colSpan={7} style={{ padding: 12, background: 'var(--panel-alt)' }}>
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
              {filtered.length === 0 && <EmptyRow colSpan={7}>No pending {docLabel.toLowerCase()}s match these filters.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
