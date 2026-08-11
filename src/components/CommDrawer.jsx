import { useState, Fragment } from 'react'
import { X } from 'lucide-react'
import { inr, toISODate } from '../lib/format'
import { StatusPill } from './ui'

const CHANNELS = ['Call', 'Email', 'WhatsApp', 'Note']
const STATUS_TAGS = ['Promise to pay', 'Reminder sent', 'Awaiting response', 'Disputed', 'Partially paid', 'Cancelled', 'No response', 'Payment received']

function relativeTime(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diffMs / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

// openDocs: pre-computed, already filtered to this customer's open items -
// [{ id, number, issued_date, amountDue, statusLabel, manualStatus,
// docType }]. Takes already-computed rows rather than raw invoices + doing
// its own computeStatus internally, specifically so this same drawer works
// for Proforma Invoices too (which have a pi_no, not an invoice_no, and no
// due_date to compute a status from) without hardcoding Sales-Invoice-only
// logic here.
//
// links: optional [{ label, onClick }] - rendered as small buttons next to
// the close button, for jumping to a related screen (e.g. "Invoice
// Follow-up ->") without leaving this drawer open on top of it.
//
// onSetStatus/manualStatusOptions: optional - when provided, each Bills
// row gets its own "Tag" select for the same manual status (Sent/Overdue/
// Paid/Invoiced/Completed) Invoice/PI Follow-up already has. Since both
// screens read the exact same sales_invoices/proforma_invoices rows,
// setting it here shows up there automatically on next load - no separate
// sync needed, it's the same underlying data either way.
//
// onRecordPayment/bankAccounts: optional - when provided, picking Paid or
// Partially Paid from the Tag select opens a real payment-recording
// mini-form (amount + account + date) right under that row instead of
// just writing the tag, matching what Invoice/PI Follow-up's Status
// column does - onSetStatus alone only ever wrote a text label with no
// effect on Collected or Cash & Bank, which is the exact gap this closes.
export default function CommDrawer({ customer, openDocs, docLabel = 'Invoice', comms, onAddComm, onClose, saving, links, onSetStatus, manualStatusOptions, onRecordPayment, bankAccounts }) {
  const [text, setText] = useState('')
  const [channel, setChannel] = useState(CHANNELS[0])
  const [tag, setTag] = useState(STATUS_TAGS[0])

  const [payingDocId, setPayingDocId] = useState(null)
  const [payTargetStatus, setPayTargetStatus] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payAccountId, setPayAccountId] = useState('')
  const [payDate, setPayDate] = useState('')
  const [payError, setPayError] = useState(null)
  const [payingBusy, setPayingBusy] = useState(false)

  const submit = async () => {
    if (!text.trim()) return
    await onAddComm({ channel, tag, note: text.trim() })
    setText('')
  }

  const handleTagChange = (doc, value) => {
    if ((value === 'Paid' || value === 'Partially Paid') && onRecordPayment) {
      setPayingDocId(doc.id)
      setPayTargetStatus(value)
      setPayAmount(value === 'Paid' ? String(doc.amountDue.toFixed(2)) : '')
      setPayAccountId(bankAccounts?.[0]?.id || '')
      setPayDate(toISODate(new Date()))
      setPayError(null)
      return
    }
    onSetStatus(doc, value)
  }

  const handleSavePayment = async (doc) => {
    setPayError(null)
    const extra = parseFloat(payAmount)
    if (!extra || extra <= 0) { setPayError('Enter a valid amount.'); return }
    if (!payAccountId) { setPayError('Select which cash or bank account this landed in.'); return }
    if (!payDate) { setPayError('Pick the date this payment was actually received.'); return }
    setPayingBusy(true)
    const result = await onRecordPayment(doc, { amount: extra, bankAccountId: payAccountId, date: payDate, status: payTargetStatus })
    setPayingBusy(false)
    if (!result.ok) { setPayError(result.error); return }
    setPayingDocId(null)
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__header">
          <h2>{customer.name}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {links && links.map((l) => (
              <button key={l.label} className="link-btn" style={{ whiteSpace: 'nowrap' }} onClick={l.onClick}>{l.label}</button>
            ))}
            <button className="drawer__close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div>
          <div className="drawer__label">Bills</div>
          <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{docLabel}</th><th>Issued</th><th className="num">Amount due</th><th>Status</th>
                {onSetStatus && <th>Tag</th>}
              </tr>
            </thead>
            <tbody>
              {openDocs.map((d) => (
                <Fragment key={d.id}>
                  <tr className="ledger-row">
                    <td className="mono">{d.number}</td>
                    <td className="mono">{toISODate(new Date(d.issued_date))}</td>
                    <td className="num mono">{inr(d.amountDue)}</td>
                    <td><StatusPill status={d.statusLabel} /></td>
                    {onSetStatus && (
                      <td>
                        <select className="select select--sm" value={d.manualStatus || ''} onChange={(e) => handleTagChange(d, e.target.value || null)}>
                          <option value="">—</option>
                          {manualStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    )}
                  </tr>
                  {payingDocId === d.id && (
                    <tr>
                      <td colSpan={onSetStatus ? 5 : 4} style={{ padding: 10, background: 'var(--panel-alt)' }}>
                        <div className="login-footnote" style={{ margin: '0 0 6px', textTransform: 'uppercase', fontSize: 11 }}>
                          Record payment — marking {payTargetStatus}
                        </div>
                        <div className="add-comm-row">
                          <input className="text-input" type="number" step="0.01" placeholder="Amount received" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                          <select className="select" value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)}>
                            <option value="" disabled>Select account…</option>
                            {(bankAccounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                          <input className="text-input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                        </div>
                        {payError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{payError}</p>}
                        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                          <button className="btn-primary" disabled={payingBusy} onClick={() => handleSavePayment(d)}>{payingBusy ? 'Saving…' : 'Save payment'}</button>
                          <button type="button" className="link-btn" onClick={() => { setPayingDocId(null); setPayError(null) }}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {openDocs.length === 0 && (
                <tr><td colSpan={onSetStatus ? 5 : 4} className="empty-state">No open bills for this client.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        <div>
          <div className="drawer__label">Communication timeline</div>
          <div className="comm-list">
            {comms.length === 0 && <p className="login-footnote">No follow-ups logged yet.</p>}
            {comms.map((c) => (
              <div key={c.id} className="comm-item">
                <div className="comm-item__top">
                  <span className="comm-tag">{c.tag}</span>
                  <span className="comm-when">{relativeTime(c.created_at)}</span>
                </div>
                <p className="comm-text">{c.note}</p>
                <span className="comm-meta">{c.channel}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="drawer__label">Log an update</div>
          <div className="add-comm-form">
            <div className="add-comm-row">
              <select className="select select--sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="select select--sm" value={tag} onChange={(e) => setTag(e.target.value)}>
                {STATUS_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <textarea
              className="textarea"
              rows={3}
              placeholder="What happened? e.g. Called, they'll pay by Friday..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : 'Log update'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
