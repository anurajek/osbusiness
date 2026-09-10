import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { toISODate, isResolved, formatDateDisplay } from '../lib/format'
import { SectionHeader } from '../components/ui'

// Pending (no remind_on set at all) is its own bucket rather than folded
// into Upcoming/Overdue - a task can be assigned without a specific date
// ("get to this at some point"), and lumping those in with dated ones
// would either hide them or misrepresent them as due on some date they
// were never actually given. This is also the reason a task with no date
// was invisible everywhere before this screen existed - the Dashboard's
// "My reminders today" query required remind_on to be set.
const BUCKETS = [
  { key: 'overdue', label: 'Overdue', dot: 'var(--brick)', empty: 'Nothing overdue.' },
  { key: 'today', label: "Today's Tasks", dot: 'var(--brass)', empty: 'Nothing due today.' },
  { key: 'pending', label: 'Pending Tasks', dot: 'var(--paper-dim)', empty: 'No open-ended tasks (no date set).' },
  { key: 'upcoming', label: 'Upcoming Tasks', dot: 'var(--teal)', empty: 'Nothing scheduled ahead.' },
]

export default function AssignedTasksScreen({ onNavigate }) {
  const { firmId, firm, membershipId } = useFirm()
  const [buckets, setBuckets] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolveNote, setResolveNote] = useState('')
  const [resolving, setResolving] = useState(false)

  const load = async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const todayISO = toISODate(new Date())

    const [
      { data: invoices, error: invErr },
      { data: bills, error: billErr },
      { data: pis, error: piErr },
      { data: custs, error: custErr },
      { data: sups, error: supErr },
      { data: members, error: memberErr },
      { data: arTasks, error: arErr },
      { data: apTasks, error: apErr },
    ] = await Promise.all([
      supabase.from('sales_invoices').select('id, customer_id, amount, paid_amount, is_cancelled, manual_status').eq('firm_id', firmId),
      supabase.from('purchase_bills').select('id, supplier_id, amount, paid_amount, is_cancelled').eq('firm_id', firmId),
      supabase.from('proforma_invoices').select('id, customer_id, amount, paid_amount, is_cancelled, manual_status').eq('firm_id', firmId),
      supabase.from('customers').select('id, name').eq('firm_id', firmId),
      supabase.from('suppliers').select('id, name').eq('firm_id', firmId),
      supabase.from('firm_members').select('id, full_name').eq('firm_id', firmId),
      // Every not-yet-resolved task assigned to me, regardless of date -
      // unlike the old Dashboard query this doesn't require remind_on to
      // be set (that's exactly what feeds the Pending bucket) or require
      // the date to have already arrived (that's Upcoming).
      membershipId
        ? supabase.from('ar_comms').select('id, customer_id, note, remind_on, remind_time, assigned_to_ids').eq('firm_id', firmId).contains('assigned_to_ids', [membershipId]).eq('reminder_done', false)
        : Promise.resolve({ data: [], error: null }),
      membershipId
        ? supabase.from('supplier_comms').select('id, supplier_id, note, remind_on, remind_time, assigned_to_ids').eq('firm_id', firmId).contains('assigned_to_ids', [membershipId]).eq('reminder_done', false)
        : Promise.resolve({ data: [], error: null }),
    ])

    const err = invErr || billErr || piErr || custErr || supErr || memberErr || arErr || apErr
    if (err) { setError(err.message); setLoading(false); return }

    const customerName = (id) => (custs ?? []).find((c) => c.id === id)?.name || '—'
    const supplierName = (id) => (sups ?? []).find((s) => s.id === id)?.name || '—'
    const assigneeNames = (ids) => (members ?? []).filter((m) => (ids ?? []).includes(m.id)).map((m) => m.full_name).join(', ')

    // Same "still actually owed" gate every other reminder surface in the
    // app uses - a task only belongs here while the customer/supplier it's
    // about still has an open balance (across Sales Invoices and PIs for a
    // customer, Purchase Bills for a supplier); once everything's settled,
    // cancelled, or manually resolved, the task drops off on its own.
    const openCustomerIds = new Set([
      ...(invoices ?? []).filter((i) => !isResolved(i)).map((i) => i.customer_id),
      ...(pis ?? []).filter((p) => !isResolved(p)).map((p) => p.customer_id),
    ])
    const openSupplierIds = new Set((bills ?? []).filter((b) => !isResolved(b)).map((b) => b.supplier_id))

    const allTasks = [
      ...(arTasks ?? [])
        .filter((r) => openCustomerIds.has(r.customer_id))
        .map((r) => ({ id: r.id, table: 'ar_comms', kind: 'ar', partyId: r.customer_id, partyName: customerName(r.customer_id), note: r.note, remindOn: r.remind_on, remindTime: r.remind_time, assignees: assigneeNames(r.assigned_to_ids) })),
      ...(apTasks ?? [])
        .filter((r) => openSupplierIds.has(r.supplier_id))
        .map((r) => ({ id: r.id, table: 'supplier_comms', kind: 'ap', partyId: r.supplier_id, partyName: supplierName(r.supplier_id), note: r.note, remindOn: r.remind_on, remindTime: r.remind_time, assignees: assigneeNames(r.assigned_to_ids) })),
    ]

    const grouped = { overdue: [], today: [], pending: [], upcoming: [] }
    for (const t of allTasks) {
      if (!t.remindOn) grouped.pending.push(t)
      else if (t.remindOn < todayISO) grouped.overdue.push(t)
      else if (t.remindOn === todayISO) grouped.today.push(t)
      else grouped.upcoming.push(t)
    }
    grouped.overdue.sort((a, b) => a.remindOn.localeCompare(b.remindOn))
    grouped.today.sort((a, b) => (a.remindTime || '').localeCompare(b.remindTime || ''))
    grouped.upcoming.sort((a, b) => a.remindOn.localeCompare(b.remindOn))
    grouped.pending.sort((a, b) => a.partyName.localeCompare(b.partyName))

    setBuckets(grouped)
    setLoading(false)
  }

  useEffect(() => { load() }, [firmId, membershipId]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolveTask = async (task) => {
    setResolving(true)
    const { error: err } = await supabase.from(task.table).update({ reminder_done: true, resolution_note: resolveNote.trim() || null }).eq('id', task.id)
    setResolving(false)
    if (err) { alert(`Couldn't resolve that task: ${err.message}`); return }
    setBuckets((b) => {
      if (!b) return b
      const next = {}
      for (const key of Object.keys(b)) next[key] = b[key].filter((t) => t.id !== task.id)
      return next
    })
    setResolvingId(null)
    setResolveNote('')
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>
  if (!buckets) return null

  const totalOpen = BUCKETS.reduce((s, b) => s + buckets[b.key].length, 0)

  return (
    <>
      <SectionHeader title="Assigned Tasks" note={firm ? `${firm.name} · tasks assigned to you` : 'tasks assigned to you'} />

      {totalOpen === 0 && (
        <div className="card"><p className="empty-state">Nothing assigned to you right now — you're clear.</p></div>
      )}

      {BUCKETS.map((b) => {
        const tasks = buckets[b.key]
        if (tasks.length === 0) return null
        return (
          <div className="card" key={b.key} style={{ marginBottom: 16 }}>
            <div className="section-header" style={{ marginBottom: 8 }}>
              <h2>{b.label}</h2>
              <span className="login-footnote" style={{ margin: 0 }}>{tasks.length}</span>
            </div>
            <ul className="activity-list">
              {tasks.map((task) => (
                <li key={task.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
                  <div className="activity-row" style={{ justifyContent: 'space-between', gap: 10 }}>
                    <span className="activity-dot" style={{ background: b.dot }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <button
                        className="link-btn" style={{ padding: 0 }}
                        onClick={() => onNavigate('arap', task.kind === 'ar' ? 'receivables' : 'payables', task.kind === 'ar' ? { customerId: task.partyId } : { supplierId: task.partyId })}
                      >
                        {task.partyName}
                      </button>
                      {' — '}{task.note}
                      {task.assignees && (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--paper-dim)', marginTop: 2 }}>
                          Assigned to: {task.assignees}
                        </span>
                      )}
                    </span>
                    {task.remindOn && (
                      <span className="activity-when">{formatDateDisplay(task.remindOn)}{task.remindTime ? `, ${task.remindTime.slice(0, 5)}` : ''}</span>
                    )}
                    {resolvingId !== task.id && (
                      <button type="button" className="link-btn" onClick={() => setResolvingId(task.id)}>Mark done</button>
                    )}
                  </div>
                  {resolvingId === task.id && (
                    <div className="resolve-form">
                      <textarea
                        className="textarea" rows={2}
                        placeholder="Optional — what happened? Leave blank to just dismiss."
                        value={resolveNote}
                        onChange={(e) => setResolveNote(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                        <button className="btn-primary" disabled={resolving} onClick={() => resolveTask(task)}>{resolving ? 'Saving…' : 'Save & resolve'}</button>
                        <button type="button" className="link-btn" onClick={() => { setResolvingId(null); setResolveNote('') }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}
