import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'

const TYPES = [
  { key: 'asset', label: 'Assets' },
  { key: 'liability', label: 'Liabilities' },
  { key: 'equity', label: 'Equity' },
  { key: 'income', label: 'Income' },
  { key: 'expense', label: 'Expenses' },
]

const emptyForm = { code: '', name: '', type: 'asset' }

export default function ChartOfAccountsScreen() {
  const { firmId } = useFirm()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  const load = async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('chart_of_accounts')
      .select('id, code, name, type, is_active')
      .eq('firm_id', firmId)
      .order('code')
    if (err) { setError(err.message); setLoading(false); return }
    setAccounts(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [firmId]) // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateForm = () => {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setShowForm(true)
  }

  const openEditForm = (account) => {
    setEditingId(account.id)
    setForm({ code: account.code, name: account.name, type: account.type })
    setFormError(null)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    if (!form.code.trim() || !form.name.trim()) {
      setFormError('Enter both a code and a name.')
      return
    }
    setSaving(true)
    const payload = { firm_id: firmId, code: form.code.trim(), name: form.name.trim(), type: form.type }
    const { error: err } = editingId
      ? await supabase.from('chart_of_accounts').update(payload).eq('id', editingId)
      : await supabase.from('chart_of_accounts').insert(payload)
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowForm(false)
    load()
  }

  const toggleActive = async (account) => {
    const { error: err } = await supabase
      .from('chart_of_accounts')
      .update({ is_active: !account.is_active })
      .eq('id', account.id)
    if (err) { alert(`Couldn't update that account: ${err.message}`); return }
    load()
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      {showForm && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 8 }}>
            <h2>{editingId ? 'Edit account' : 'New account'}</h2>
          </div>
          <form onSubmit={handleSubmit} className="add-comm-form">
            <div className="add-comm-row">
              <input className="text-input" placeholder="Code (e.g. 1200)" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
              <input className="text-input" placeholder="Name (e.g. Petty Cash)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <select className="select select--sm" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            {formError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{formError}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add account'}</button>
              <button type="button" className="link-btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {!showForm && (
        <div className="card" style={{ padding: 16 }}>
          <button className="btn-primary" onClick={openCreateForm}>+ New account</button>
        </div>
      )}

      {TYPES.map((t) => {
        const rows = accounts.filter((a) => a.type === t.key)
        if (rows.length === 0) return null
        return (
          <div key={t.key} className="card">
            <div className="section-header" style={{ marginBottom: 8 }}><h2>{t.label}</h2></div>
            <div className="table-scroll">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="ledger-row">
                      <td>{a.code}</td>
                      <td>{a.name}</td>
                      <td>{a.is_active ? <span className="pill pill--ok">Active</span> : <span className="pill pill--neutral">Inactive</span>}</td>
                      <td className="num">
                        <button className="link-btn" onClick={() => openEditForm(a)}>Edit</button>
                        {' '}
                        <button className="link-btn" onClick={() => toggleActive(a)}>{a.is_active ? 'Deactivate' : 'Reactivate'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {accounts.length === 0 && !showForm && (
        <div className="card empty-state">No accounts yet - add your first one above.</div>
      )}
    </>
  )
}
