import { useState, useRef, Fragment } from 'react'
import { X } from 'lucide-react'
import { inr, toISODate, isPlausibleDate } from '../lib/format'
import { StatusPill } from './ui'

const CHANNELS = ['Call', 'Email', 'WhatsApp', 'Note']
// 'No response' removed (Sep 2026) - a follow-up that genuinely got no
// response is better logged as 'Awaiting response' with a Remind-me-on
// date than tagged with a dead-end label nobody acts on.
const STATUS_TAGS = ['Promise to pay', 'Reminder sent', 'Awaiting response', 'Disputed', 'Partially paid', 'Cancelled', 'Payment received']

// Quick-pick offsets for "Remind me on" - loosely modeled on Anuraj's own
// accounts-follow-up cadence (early nudge, on/after due date, then longer
// escalation windows) but kept as plain day-offsets from today rather than
// tied to a specific due date, since this drawer serves customers/suppliers
// generally (not just one invoice) and PIs don't always have a due date to
// offset from anyway.
const REMIND_PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: '+3d', days: 3 },
  { label: '+7d', days: 7 },
  { label: '+14d', days: 14 },
  { label: '+30d', days: 30 },
]

function relativeTime(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diffMs / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

function addDaysISO(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

function isReminderDue(remindOn) {
  if (!remindOn) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(remindOn + 'T00:00:00')
  return target <= today
}

// Postgres returns a `time` column as "HH:MM:SS" - formats that (or the
// "HH:MM" a native <input type="time"> gives while editing) as "3:00 PM".
function formatTime(t) {
  if (!t) return null
  const [hStr, mStr] = t.split(':')
  const h = Number(hStr), m = Number(mStr)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// Escapes regex special characters in a member's name before it goes into
// a RegExp - full names can contain periods, parentheses, etc.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Splits a note's text on any "@Full Name" that matches a real firm member,
// so those tokens can be rendered as highlighted spans. Longest names first,
// so "Sneha N" doesn't get partially matched inside "Sneha Nair".
function renderNoteWithMentions(note, members) {
  const names = (members ?? []).map((m) => m.full_name).filter(Boolean).sort((a, b) => b.length - a.length)
  if (names.length === 0) return note
  const pattern = new RegExp(`@(${names.map(escapeRegExp).join('|')})`, 'g')
  const parts = []
  let lastIndex = 0
  let match
  while ((match = pattern.exec(note)) !== null) {
    if (match.index > lastIndex) parts.push(note.slice(lastIndex, match.index))
    parts.push(<span key={match.index} className="comm-mention">{match[0]}</span>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < note.length) parts.push(note.slice(lastIndex))
  return parts
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
//
// members: optional [{ id, full_name }] - firm members, used for the
// @mention autocomplete, the multi-person "Assign to" chips, and resolving
// assigned_to_ids/mentioned_member_ids back to display names. When omitted
// (or empty), the mention/assign features simply don't render.
//
// onResolveReminder: optional (commId, note|null) => void - called when
// someone dismisses a pending "Remind me on" tag, with an optional note
// on what actually happened (or null for a plain dismiss with nothing to
// report).
export default function CommDrawer({ customer, openDocs, docLabel = 'Invoice', comms, onAddComm, onClose, saving, links, onSetStatus, manualStatusOptions, onRecordPayment, bankAccounts, members, onResolveReminder }) {
  const [text, setText] = useState('')
  const [channel, setChannel] = useState(CHANNELS[0])
  const [tag, setTag] = useState(STATUS_TAGS[0])
  const [remindOn, setRemindOn] = useState('')
  const [remindTime, setRemindTime] = useState('')
  const [remindError, setRemindError] = useState(null)

  // Mention autocomplete state - mentionStart is the index of the "@" that
  // triggered the current query, so selecting a suggestion knows exactly
  // what span of text to replace even if the person kept typing after it.
  const [mentionQuery, setMentionQuery] = useState(null)
  const [mentionStart, setMentionStart] = useState(null)
  const textareaRef = useRef(null)

  // Resolve-with-note state, for the reminder being dismissed right now.
  const [resolvingId, setResolvingId] = useState(null)
  const [resolveNote, setResolveNote] = useState('')
  const [resolving, setResolving] = useState(false)

  const [payingDocId, setPayingDocId] = useState(null)
  const [payTargetStatus, setPayTargetStatus] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payAccountId, setPayAccountId] = useState('')
  const [payDate, setPayDate] = useState('')
  const [payError, setPayError] = useState(null)
  const [payingBusy, setPayingBusy] = useState(false)

  const memberList = members ?? []

  const handleTextChange = (e) => {
    const value = e.target.value
    const cursor = e.target.selectionStart
    setText(value)

    const upToCursor = value.slice(0, cursor)
    const at = upToCursor.lastIndexOf('@')
    // Only treat this as a mention trigger if the "@" starts a word - i.e.
    // it's at the very start of the note or preceded by whitespace, and
    // there's no whitespace between it and the cursor (still mid-word).
    const charBefore = at <= 0 ? ' ' : upToCursor[at - 1]
    if (at === -1 || !/\s/.test(charBefore) || /\s/.test(upToCursor.slice(at + 1))) {
      setMentionQuery(null)
      setMentionStart(null)
      return
    }
    setMentionQuery(upToCursor.slice(at + 1))
    setMentionStart(at)
  }

  const mentionMatches = mentionQuery === null
    ? []
    : memberList.filter((m) => m.full_name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5)

  const selectMention = (member) => {
    if (mentionStart === null) return
    const cursor = textareaRef.current?.selectionStart ?? text.length
    const before = text.slice(0, mentionStart)
    const after = text.slice(cursor)
    const inserted = `@${member.full_name} `
    const newText = before + inserted + after
    setText(newText)
    setMentionQuery(null)
    setMentionStart(null)
    requestAnimationFrame(() => {
      const pos = (before + inserted).length
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(pos, pos)
    })
  }

  // Reads mentioned members back out of the final text rather than trusting
  // insertion-order state - if someone deletes an "@Name" after inserting
  // it, it correctly stops counting as a mention. Self-correcting either way.
  const extractMentionedIds = (noteText) =>
    memberList.filter((m) => noteText.includes(`@${m.full_name}`)).map((m) => m.id)

  const submit = async () => {
    if (!text.trim()) return
    if (remindOn && !isPlausibleDate(remindOn)) { setRemindError("That reminder date doesn't look right - check the year."); return }
    setRemindError(null)
    await onAddComm({
      channel, tag, note: text.trim(),
      assignedIds: [],
      remindOn: remindOn || null,
      remindTime: remindOn && remindTime ? remindTime : null,
      mentionedIds: extractMentionedIds(text.trim()),
    })
    setText('')
    setRemindOn('')
    setRemindTime('')
    setMentionQuery(null)
    setMentionStart(null)
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

  const handleResolve = async (commId) => {
    setResolving(true)
    await onResolveReminder(commId, resolveNote.trim() || null)
    setResolving(false)
    setResolvingId(null)
    setResolveNote('')
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
            {comms.map((c) => {
              const assignedMembers = memberList.filter((m) => (c.assigned_to_ids ?? []).includes(m.id))
              const due = isReminderDue(c.remind_on)
              const timeLabel = formatTime(c.remind_time)
              return (
                <div key={c.id} className="comm-item">
                  <div className="comm-item__top">
                    <span className="comm-tag">{c.tag}</span>
                    <span className="comm-when">{relativeTime(c.created_at)}</span>
                  </div>
                  <p className="comm-text">{renderNoteWithMentions(c.note, memberList)}</p>
                  <div className="comm-meta-row">
                    <span className="comm-meta">{c.channel}</span>
                    {assignedMembers.map((m) => <span key={m.id} className="pill pill--neutral">→ {m.full_name}</span>)}
                    {c.remind_on && (
                      <span className={`pill ${c.reminder_done ? 'pill--ok' : due ? 'pill--bad' : 'pill--warn'}`}>
                        {c.reminder_done ? '✓ Reminded' : 'Remind'} {c.remind_on}{timeLabel ? `, ${timeLabel}` : ''}
                      </span>
                    )}
                    {c.remind_on && !c.reminder_done && onResolveReminder && resolvingId !== c.id && (
                      <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => setResolvingId(c.id)}>Mark done</button>
                    )}
                  </div>
                  {c.reminder_done && c.resolution_note && (
                    <p className="comm-text" style={{ marginTop: 4, color: 'var(--paper-dim)' }}>↳ {c.resolution_note}</p>
                  )}
                  {resolvingId === c.id && (
                    <div className="resolve-form">
                      <textarea
                        className="textarea" rows={2}
                        placeholder="Optional — what happened? Leave blank to just dismiss."
                        value={resolveNote}
                        onChange={(e) => setResolveNote(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                        <button className="btn-primary" disabled={resolving} onClick={() => handleResolve(c.id)}>{resolving ? 'Saving…' : 'Save & resolve'}</button>
                        <button type="button" className="link-btn" onClick={() => { setResolvingId(null); setResolveNote('') }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="drawer__label">Update</div>
          <div className="add-comm-form">
            <div className="add-comm-row">
              <select className="select select--sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="select select--sm" value={tag} onChange={(e) => setTag(e.target.value)}>
                {STATUS_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div style={{ position: 'relative' }}>
              <textarea
                ref={textareaRef}
                className="textarea"
                rows={3}
                placeholder={memberList.length > 0 ? "What happened? e.g. Called, they'll pay by Friday. Type @ to mention a teammate." : "What happened? e.g. Called, they'll pay by Friday..."}
                value={text}
                onChange={handleTextChange}
              />
              {mentionQuery !== null && mentionMatches.length > 0 && (
                <div className="mention-menu">
                  {mentionMatches.map((m) => (
                    <button type="button" key={m.id} className="mention-menu__item" onClick={() => selectMention(m)}>{m.full_name}</button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Remind me on (optional)</label>
              <div className="chip-row">
                <input className="text-input" style={{ maxWidth: 160 }} type="date" value={remindOn} onChange={(e) => setRemindOn(e.target.value)} />
                <input className="text-input" style={{ maxWidth: 120 }} type="time" value={remindTime} onChange={(e) => setRemindTime(e.target.value)} disabled={!remindOn} title={remindOn ? 'Time (optional)' : 'Pick a date first'} />
                {REMIND_PRESETS.map((p) => (
                  <button type="button" key={p.label} className="chip-btn" onClick={() => setRemindOn(addDaysISO(p.days))}>{p.label}</button>
                ))}
                {remindOn && <button type="button" className="link-btn" onClick={() => { setRemindOn(''); setRemindTime('') }}>Clear</button>}
              </div>
              {remindError && <p className="text-[12.5px]" style={{ color: 'var(--brick)', marginTop: 4 }}>{remindError}</p>}
            </div>

            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : 'Update'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
