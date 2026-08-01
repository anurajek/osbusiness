import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, toISODate } from '../lib/format'

function emptyLine() { return { account_id: '', debit: '', credit: '', description: '' } }

export default function JournalEntriesScreen() {
  const { firmId, role } = useFirm()
  const isOwner = role === 'Owner'

  const [entries, setEntries] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [linesByEntry, setLinesByEntry] = useState({})
  const [busyId, setBusyId] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [entryDate, setEntryDate] = useState(toISODate(new Date()))
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState([emptyLine(), emptyLine()])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  const load = async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [entriesRes, accountsRes] = await Promise.all([
      supabase.from('journal_entries').select('id, entry_date, reference, status').eq('firm_id', firmId).order('entry_date', { ascending: false }),
      supabase.from('chart_of_accounts').select('id, code, name').eq('firm_id', firmId).eq('is_active', true).order('code'),
    ])
    if (entriesRes.error) { setError(entriesRes.error.message); setLoading(false); return }
    setEntries(entriesRes.data ?? [])
    setAccounts(accountsRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [firmId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = async (entryId) => {
    if (expandedId === entryId) { setExpandedId(null); return }
    setExpandedId(entryId)
    if (!linesByEntry[entryId]) {
      const { data, error: err } = await supabase
        .from('journal_entry_lines')
        .select('id, debit, credit, description, chart_of_accounts(code, name)')
        .eq('entry_id', entryId)
      if (!err) setLinesByEntry((prev) => ({ ...prev, [entryId]: data ?? [] }))
    }
  }

  const updateLine = (i, patch) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i) => setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)))

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)
  const balanced = totalDebit > 0 && Math.round(totalDebit * 100) === Math.round(totalCredit * 100)

  const openCreateForm = () => {
    setEntryDate(toISODate(new Date()))
    setReference('')
    setLines([emptyLine(), emptyLine()])
    setFormError(null)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    const cleanLines = lines
      .filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({ account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description }))
    if (cleanLines.length < 2) {
      setFormError('Add at least two lines with an account and an amount.')
      return
    }
    if (!balanced) {
      setFormError(`Debits (${inr(totalDebit)}) and credits (${inr(totalCredit)}) must match.`)
      return
    }
    setSaving(true)
    const { error: err } = await supabase.rpc('create_journal_entry', {
      p_firm_id: firmId,
      p_entry_date: entryDate,
      p_reference: reference.trim(),
      p_lines: cleanLines,
    })
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowForm(false)
    load()
  }

  const handlePost = async (entryId) => {
    if (!window.confirm('Post this entry? Posted entries become permanent and can no longer be edited or deleted.')) return
    setBusyId(entryId)
    const { error: err } = await supabase.rpc('post_journal_entry', { p_entry_id: entryId })
    setBusyId(null)
    if (err) { alert(`Couldn't post that entry: ${err.message}`); return }
    load()
  }

  const handleDelete = async (entryId) => {
    if (!window.confirm('Delete this draft entry? This cannot be undone.')) return
    setBusyId(entryId)
    const { error: err } = await supabase.from('journal_entries').delete().eq('id', entryId)
    setBusyId(null)
    if (err) { alert(`Couldn't delete that entry: ${err.message}`); return }
    if (expandedId === entryId) setExpandedId(null)
    load()
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      {showForm ? (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 8 }}><h2>New journal entry</h2></div>
          <form onSubmit={handleSubmit}>
            <div className="add-comm-row" style={{ marginBottom: 12 }}>
              <input type="date" className="date-input" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              <input className="text-input" placeholder="Reference / memo" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>

            <div className="table-scroll">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Description</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="ledger-row">
                      <td>
                        <select className="select select--sm" value={line.account_id} onChange={(e) => updateLine(i, { account_id: e.target.value })}>
                          <option value="">Select account…</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                        </select>
                      </td>
                      <td><input className="text-input" value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} /></td>
                      <td className="num"><input type="number" step="0.01" min="0" className="text-input" style={{ textAlign: 'right' }} value={line.debit} onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? '' : line.credit })} /></td>
                      <td className="num"><input type="number" step="0.01" min="0" className="text-input" style={{ textAlign: 'right' }} value={line.credit} onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? '' : line.debit })} /></td>
                      <td>{lines.length > 2 && <button type="button" className="link-btn" onClick={() => removeLine(i)}>Remove</button>}</td>
                    </tr>
                  ))}
                  <tr className="ledger-row">
                    <td colSpan={2}><button type="button" className="link-btn" onClick={addLine}>+ Add line</button></td>
                    <td className="num" style={{ fontWeight: 600 }}>{inr(totalDebit)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{inr(totalCredit)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-[12.5px]" style={{ marginTop: 10, color: balanced ? 'var(--teal)' : 'var(--paper-dim)' }}>
              {balanced ? '✓ Balanced' : `Difference: ${inr(Math.abs(totalDebit - totalCredit))}`}
            </p>
            {formError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{formError}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save as draft'}</button>
              <button type="button" className="link-btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <button className="btn-primary" onClick={openCreateForm}>+ New journal entry</button>
        </div>
      )}

      <div className="card">
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr className="ledger-row" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(entry.id)}>
                    <td>{entry.entry_date}</td>
                    <td>{entry.reference || <span className="login-footnote" style={{ margin: 0 }}>—</span>}</td>
                    <td>{entry.status === 'posted' ? <span className="pill pill--ok">Posted</span> : <span className="pill pill--warn">Draft</span>}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      {entry.status === 'draft' && isOwner && (
                        <button className="link-btn" disabled={busyId === entry.id} onClick={() => handlePost(entry.id)}>Post</button>
                      )}
                      {entry.status === 'draft' && (
                        <>{' '}<button className="link-btn" style={{ color: 'var(--brick)' }} disabled={busyId === entry.id} onClick={() => handleDelete(entry.id)}>Delete</button></>
                      )}
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr>
                      <td colSpan={4} style={{ padding: 0 }}>
                        <table className="ledger-table" style={{ margin: '4px 0 10px 0' }}>
                          <tbody>
                            {(linesByEntry[entry.id] ?? []).map((l) => (
                              <tr key={l.id} className="ledger-row">
                                <td style={{ paddingLeft: 24 }}>{l.chart_of_accounts?.code} - {l.chart_of_accounts?.name}</td>
                                <td>{l.description || ''}</td>
                                <td className="num">{l.debit > 0 ? inr(l.debit) : ''}</td>
                                <td className="num">{l.credit > 0 ? inr(l.credit) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={4} className="empty-state">No journal entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
