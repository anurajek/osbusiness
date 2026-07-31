import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, toISODate } from '../lib/format'
import { PeriodSelector, FilterBar, SORT_OPTIONS_DATE_AMOUNT, sortRows } from '../components/FilterControls'
import { StatusPill, SectionHeader, EmptyRow } from '../components/ui'

const SALES_STATUSES = ['Paid', 'Sent', 'Partial', 'Overdue']
const PURCHASE_STATUSES = ['Paid', 'Approved', 'Due today', 'Overdue']

export default function InvoiceListScreen({ type }) {
  const { firmId } = useFirm()
  const isSales = type === 'sales'
  const statusOptions = isSales ? SALES_STATUSES : PURCHASE_STATUSES
  const partyLabel = isSales ? 'customer' : 'supplier'
  const docLabel = isSales ? 'invoice' : 'bill'

  const [rows, setRows] = useState([])
  const [parties, setParties] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [partyFilter, setPartyFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')
  const [search, setSearch] = useState('')

  const [showAddParty, setShowAddParty] = useState(false)
  const [newPartyName, setNewPartyName] = useState('')
  const [newPartyGstin, setNewPartyGstin] = useState('')
  const [newPartyContact, setNewPartyContact] = useState('')
  const [addingParty, setAddingParty] = useState(false)
  const [addPartyError, setAddPartyError] = useState(null)

  const [showAddDoc, setShowAddDoc] = useState(false)
  const [editingDocId, setEditingDocId] = useState(null)
  const [newDocPartyId, setNewDocPartyId] = useState('')
  const [newDocNumber, setNewDocNumber] = useState('')
  const [newDocIssuedDate, setNewDocIssuedDate] = useState(() => toISODate(new Date()))
  const [newDocDueDate, setNewDocDueDate] = useState('')
  const [newDocAmount, setNewDocAmount] = useState('')
  const [newDocPaid, setNewDocPaid] = useState('0')
  const [newDocStatus, setNewDocStatus] = useState(isSales ? 'Sent' : 'Approved')
  const [addingDoc, setAddingDoc] = useState(false)
  const [addDocError, setAddDocError] = useState(null)

  const partyTable = isSales ? 'customers' : 'suppliers'
  const table = isSales ? 'sales_invoices' : 'purchase_bills'
  const partyJoinKey = isSales ? 'customer_id' : 'supplier_id'
  const numberField = isSales ? 'invoice_no' : 'bill_no'

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)

    const { data: partyRows, error: partyErr } = await supabase
      .from(partyTable).select('id, name').eq('firm_id', firmId).order('name')

    const { data: invoiceRows, error: invErr } = await supabase
      .from(table)
      .select(`id, ${numberField}, ${partyJoinKey}, issued_date, due_date, amount, paid_amount, status`)
      .eq('firm_id', firmId)
      .order('issued_date', { ascending: false })

    if (partyErr || invErr) {
      setError((partyErr || invErr).message)
      setLoading(false)
      return
    }
    setParties(partyRows ?? [])
    setRows(invoiceRows ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, isSales])

  useEffect(() => { load() }, [load])

  const partyName = (id) => parties.find((p) => p.id === id)?.name || '—'
  const range = getPeriodRange(period, customFrom, customTo)

  const filtered = useMemo(() => {
    let list = rows;
    if (range) {
      list = list.filter((r) => {
        const d = new Date(r.issued_date)
        return d >= range.from && d <= range.to
      })
    }
    if (partyFilter !== 'all') list = list.filter((r) => r[partyJoinKey] === partyFilter)
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (r) => r[numberField]?.toLowerCase().includes(q) || partyName(r[partyJoinKey]).toLowerCase().includes(q)
      )
    }
    return sortRows(list, sortBy, 'issued_date')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range, partyFilter, statusFilter, search, sortBy, parties])

  const handleAddParty = async (e) => {
    e.preventDefault()
    setAddPartyError(null)
    if (!newPartyName.trim()) { setAddPartyError('Enter a name.'); return }
    setAddingParty(true)
    const { error: err } = await supabase.from(partyTable).insert({
      firm_id: firmId,
      name: newPartyName.trim(),
      gstin: newPartyGstin.trim() || null,
      contact: newPartyContact.trim() || null,
    })
    setAddingParty(false)
    if (err) { setAddPartyError(err.message); return }
    setNewPartyName(''); setNewPartyGstin(''); setNewPartyContact('')
    setShowAddParty(false)
    load()
  }

  const resetDocForm = () => {
    setEditingDocId(null)
    setNewDocPartyId(''); setNewDocNumber('')
    setNewDocIssuedDate(toISODate(new Date())); setNewDocDueDate('')
    setNewDocAmount(''); setNewDocPaid('0')
    setNewDocStatus(isSales ? 'Sent' : 'Approved')
  }

  const openCreateForm = () => {
    resetDocForm()
    setShowAddDoc(true)
  }

  const openEditForm = (row) => {
    setEditingDocId(row.id)
    setNewDocPartyId(row[partyJoinKey] || '')
    setNewDocNumber(row[numberField] || '')
    setNewDocIssuedDate(row.issued_date ? toISODate(new Date(row.issued_date)) : toISODate(new Date()))
    setNewDocDueDate(row.due_date ? toISODate(new Date(row.due_date)) : '')
    setNewDocAmount(String(row.amount ?? ''))
    setNewDocPaid(String(row.paid_amount ?? '0'))
    setNewDocStatus(row.status || (isSales ? 'Sent' : 'Approved'))
    setShowAddDoc(true)
  }

  const handleAddDoc = async (e) => {
    e.preventDefault()
    setAddDocError(null)

    if (!newDocPartyId) { setAddDocError(`Select a ${partyLabel}.`); return }
    if (!newDocNumber.trim()) { setAddDocError(`Enter a ${docLabel} number.`); return }
    const amountNum = parseFloat(newDocAmount)
    if (!amountNum || amountNum <= 0) { setAddDocError('Enter a valid amount.'); return }
    const paidNum = parseFloat(newDocPaid) || 0

    const payload = {
      [partyJoinKey]: newDocPartyId,
      [numberField]: newDocNumber.trim(),
      issued_date: newDocIssuedDate,
      due_date: newDocDueDate || null,
      amount: amountNum,
      paid_amount: paidNum,
      status: newDocStatus,
    }

    setAddingDoc(true)
    const { error: err } = editingDocId
      ? await supabase.from(table).update(payload).eq('id', editingDocId)
      : await supabase.from(table).insert({ firm_id: firmId, ...payload })

    if (!err) {
      // Best-effort activity log entry - if this fails, don't block the user
      await supabase.from('activity_log').insert({
        firm_id: firmId,
        description: `${isSales ? 'Sales invoice' : 'Purchase bill'} ${newDocNumber.trim()} ${editingDocId ? 'updated' : 'added'} for ${partyName(newDocPartyId)} — ${inr(amountNum)}`,
      })
    }

    setAddingDoc(false)
    if (err) { setAddDocError(err.message); return }
    resetDocForm()
    setShowAddDoc(false)
    load()
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader
        title={isSales ? 'Sales invoices' : 'Purchase bills'}
        note={isSales ? 'what your customers owe you, invoice by invoice' : 'what you owe your suppliers, bill by bill'}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: showAddParty ? 12 : 0 }}>
          <h2 style={{ textTransform: 'capitalize' }}>{partyLabel}s</h2>
          <button className="link-btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setShowAddParty((v) => !v)}>
            <Plus size={14} /> New {partyLabel}
          </button>
        </div>
        {showAddParty && (
          <form onSubmit={handleAddParty} className="add-comm-form">
            <div className="add-comm-row">
              <input className="text-input" placeholder="Name" value={newPartyName} onChange={(e) => setNewPartyName(e.target.value)} />
              <input className="text-input" placeholder="GSTIN (optional)" value={newPartyGstin} onChange={(e) => setNewPartyGstin(e.target.value)} />
              <input className="text-input" placeholder="Contact (optional)" value={newPartyContact} onChange={(e) => setNewPartyContact(e.target.value)} />
            </div>
            {addPartyError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{addPartyError}</p>}
            <button className="btn-primary" disabled={addingParty}>{addingParty ? 'Adding…' : `Add ${partyLabel}`}</button>
          </form>
        )}
      </div>

      <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: isSales ? 'Search invoice # or customer...' : 'Search bill # or supplier...' }}
        filters={[
          {
            label: isSales ? 'Customer' : 'Supplier', value: partyFilter, onChange: setPartyFilter,
            options: [{ value: 'all', label: 'All' }, ...parties.map((p) => ({ value: p.id, label: p.name }))],
          },
          {
            label: 'Status', value: statusFilter, onChange: setStatusFilter,
            options: [{ value: 'all', label: 'All' }, ...statusOptions.map((s) => ({ value: s, label: s }))],
          },
        ]}
        sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS_DATE_AMOUNT }}
      />
      <div className="card">
        <div className="section-header" style={{ marginBottom: showAddDoc ? 12 : 8 }}>
          <span className="section-header__note">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
          <button
            className="link-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => (showAddDoc && !editingDocId ? setShowAddDoc(false) : openCreateForm())}
            disabled={parties.length === 0}
            title={parties.length === 0 ? `Add a ${partyLabel} first` : undefined}
          >
            <Plus size={14} /> New {docLabel}
          </button>
        </div>

        {parties.length === 0 && !showAddDoc && (
          <p className="login-footnote" style={{ marginTop: -4, marginBottom: 12 }}>
            Add a {partyLabel} above before creating a {docLabel}.
          </p>
        )}

        {showAddDoc && (
          <form onSubmit={handleAddDoc} className="add-comm-form" style={{ marginBottom: 16 }}>
            <div className="drawer__label" style={{ marginBottom: -4 }}>
              {editingDocId ? `Editing ${docLabel}` : `New ${docLabel}`}
            </div>
            <div className="add-comm-row">
              <select className="select select--sm" value={newDocPartyId} onChange={(e) => setNewDocPartyId(e.target.value)}>
                <option value="">{isSales ? 'Select customer' : 'Select supplier'}</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input
                className="text-input"
                placeholder={isSales ? 'Invoice # (e.g. INV-1045)' : 'Bill # (e.g. PB-2240)'}
                value={newDocNumber}
                onChange={(e) => setNewDocNumber(e.target.value)}
              />
              <select className="select select--sm" value={newDocStatus} onChange={(e) => setNewDocStatus(e.target.value)}>
                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="add-comm-row">
              <div style={{ flex: 1 }}>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Issued date</label>
                <input type="date" className="text-input" value={newDocIssuedDate} onChange={(e) => setNewDocIssuedDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Due date (optional)</label>
                <input type="date" className="text-input" value={newDocDueDate} onChange={(e) => setNewDocDueDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Amount (₹)</label>
                <input type="number" min="0" step="0.01" className="text-input" value={newDocAmount} onChange={(e) => setNewDocAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Already paid (₹)</label>
                <input type="number" min="0" step="0.01" className="text-input" value={newDocPaid} onChange={(e) => setNewDocPaid(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            {addDocError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{addDocError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" disabled={addingDoc}>
                {addingDoc ? 'Saving…' : editingDocId ? 'Save changes' : `Add ${docLabel}`}
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => { resetDocForm(); setShowAddDoc(false) }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <table className="ledger-table">
          <thead>
            <tr>
              <th>{isSales ? 'Invoice' : 'Bill'}</th>
              <th>{isSales ? 'Customer' : 'Supplier'}</th>
              <th>Issued</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="ledger-row">
                <td className="mono">{r[numberField]}</td>
                <td>{partyName(r[partyJoinKey])}</td>
                <td className="mono">{r.issued_date ? toISODate(new Date(r.issued_date)) : '—'}</td>
                <td className="num mono">{inr(r.amount)}</td>
                <td><StatusPill status={r.status} /></td>
                <td><button className="link-btn" onClick={() => openEditForm(r)}>Edit</button></td>
              </tr>
            ))}
            {filtered.length === 0 && <EmptyRow colSpan={6}>No records match these filters.</EmptyRow>}
          </tbody>
        </table>
      </div>
    </>
  )
}
