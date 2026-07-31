import { useState } from 'react'
import { X } from 'lucide-react'
import { inr, toISODate, computeStatus } from '../lib/format'
import { StatusPill } from './ui'

const CHANNELS = ['Call', 'Email', 'WhatsApp', 'Note']
const STATUS_TAGS = ['Promise to pay', 'Reminder sent', 'Awaiting response', 'Disputed', 'Partially paid', 'No response', 'Payment received']

function relativeTime(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diffMs / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

export default function CommDrawer({ customer, invoices, comms, onAddComm, onClose, saving }) {
  const [text, setText] = useState('')
  const [channel, setChannel] = useState(CHANNELS[0])
  const [tag, setTag] = useState(STATUS_TAGS[0])

  const openInvoices = invoices
    .filter((i) => i.customer_id === customer.id)
    .map((i) => ({ ...i, liveStatus: computeStatus(i, 'Sent') }))
    .filter((i) => i.liveStatus !== 'Paid')

  const submit = async () => {
    if (!text.trim()) return
    await onAddComm({ channel, tag, note: text.trim() })
    setText('')
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__header">
          <h2>{customer.name}</h2>
          <button className="drawer__close" onClick={onClose}><X size={18} /></button>
        </div>

        <div>
          <div className="drawer__label">Bills</div>
          <table className="ledger-table">
            <thead><tr><th>Invoice</th><th>Issued</th><th className="num">Amount due</th><th>Status</th></tr></thead>
            <tbody>
              {openInvoices.map((i) => (
                <tr key={i.id} className="ledger-row">
                  <td className="mono">{i.invoice_no}</td>
                  <td className="mono">{toISODate(new Date(i.issued_date))}</td>
                  <td className="num mono">{inr(i.amount - i.paid_amount)}</td>
                  <td><StatusPill status={i.liveStatus} /></td>
                </tr>
              ))}
              {openInvoices.length === 0 && (
                <tr><td colSpan={4} className="empty-state">No open bills for this client.</td></tr>
              )}
            </tbody>
          </table>
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
