import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Download } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, toISODate } from '../lib/format'
import { downloadQuotePdf, downloadListPdf } from '../lib/pdf'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListDocx } from '../lib/exportDocx'
import { FilterBar, sortRows } from '../components/FilterControls'
import { SectionHeader, EmptyRow, SortableTh } from '../components/ui'

const STATUS_OPTIONS = ['draft', 'sent', 'accepted', 'declined', 'expired', 'converted']
const STATUS_PILL = {
  draft: 'pill pill--neutral',
  sent: 'pill pill--neutral',
  accepted: 'pill pill--ok',
  declined: 'pill pill--bad',
  expired: 'pill pill--bad',
  converted: 'pill pill--ok',
}

function emptyLine() { return { description: '', quantity: 1, unit_price: '' } }

// A quote past its valid_until date reads as "expired" for display even
// though the stored status is still whatever it was (draft/sent) - this is
// the same "computed, not manually set" pattern used for invoice/bill
// status elsewhere. Accepted/declined/converted are real business actions,
// not derivable from data, so those stay as explicitly stored.
function displayStatus(q) {
  if (['accepted', 'declined', 'converted'].includes(q.status)) return q.status
  if (q.valid_until && new Date(q.valid_until) < new Date(new Date().setHours(0, 0, 0, 0))) return 'expired'
  return q.status
}

export default function QuotationsScreen() {
  const { firmId, firm } = useFirm()

  const [rows, setRows] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [customerFilter, setCustomerFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')
  const [search, setSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formCustomerId, setFormCustomerId] = useState('')
  const [formNumber, setFormNumber] = useState('')
  const [formIssuedDate, setFormIssuedDate] = useState(() => toISODate(new Date()))
  const [formValidUntil, setFormValidUntil] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formLines, setFormLines] = useState([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [customersRes, quotesRes] = await Promise.all([
      supabase.from('customers').select('id, name, gstin, address, email').eq('firm_id', firmId).order('name'),
      supabase
        .from('quotes')
        .select('id, quote_no, customer_id, issued_date, valid_until, status, notes, converted_invoice_id, quote_line_items(amount)')
        .eq('firm_id', firmId)
        .order('issued_date', { ascending: false }),
    ])
    if (customersRes.error || quotesRes.error) {
      setError((customersRes.error || quotesRes.error).message)
      setLoading(false)
      return
    }
    setCustomers(customersRes.data ?? [])
    setRows((quotesRes.data ?? []).map((q) => ({ ...q, total: (q.quote_line_items || []).reduce((s, l) => s + Number(l.amount || 0), 0) })))
    setLoading(false)
  }, [firmId])

  useEffect(() => { load() }, [load])

  const customerName = (id) => customers.find((c) => c.id === id)?.name || '—'
  const customerById = (id) => customers.find((c) => c.id === id) || null
  const range = getPeriodRange(period, customFrom, customTo)

  const filtered = useMemo(() => {
    let list = rows
    if (range) list = list.filter((r) => { const d = new Date(r.issued_date); return d >= range.from && d <= range.to })
    if (customerFilter !== 'all') list = list.filter((r) => r.customer_id === customerFilter)
    if (statusFilter !== 'all') list = list.filter((r) => displayStatus(r) === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((r) => r.quote_no?.toLowerCase().includes(q) || customerName(r.customer_id).toLowerCase().includes(q))
    }
    return sortRows(list, sortBy, 'issued_date', 'total')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range, customerFilter, statusFilter, search, sortBy, customers])

  const handleExportCsv = () => {
    downloadCsv(
      'quotations',
      ['Quote #', 'Customer', 'Issued', 'Valid Until', 'Total', 'Status'],
      filtered.map((r) => [r.quote_no, customerName(r.customer_id), r.issued_date, r.valid_until || '', r.total.toFixed(2), displayStatus(r)])
    )
  }

  const handleExportPdf = () => {
    downloadListPdf({
      title: 'Quotations',
      firm,
      filename: 'quotations',
      columns: [
        { label: 'Quote #' }, { label: 'Customer' }, { label: 'Issued' }, { label: 'Total', align: 'right' }, { label: 'Status' },
      ],
      rows: filtered.map((r) => [r.quote_no, customerName(r.customer_id), r.issued_date, inr(r.total), displayStatus(r)]),
    })
  }

  const handleExportWord = () => {
    downloadListDocx({
      title: 'Quotations',
      firm,
      filename: 'quotations',
      columns: [
        { label: 'Quote #' }, { label: 'Customer' }, { label: 'Issued' }, { label: 'Total', align: 'right' }, { label: 'Status' },
      ],
      rows: filtered.map((r) => [r.quote_no, customerName(r.customer_id), r.issued_date, inr(r.total), displayStatus(r)]),
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setFormCustomerId(''); setFormNumber('')
    setFormIssuedDate(toISODate(new Date())); setFormValidUntil('')
    setFormNotes(''); setFormLines([emptyLine()])
    setFormError(null)
  }

  const openCreateForm = () => { resetForm(); setShowForm(true) }

  const openEditForm = async (row) => {
    setEditingId(row.id)
    setFormCustomerId(row.customer_id)
    setFormNumber(row.quote_no)
    setFormIssuedDate(toISODate(new Date(row.issued_date)))
    setFormValidUntil(row.valid_until ? toISODate(new Date(row.valid_until)) : '')
    setFormNotes(row.notes || '')
    setFormError(null)
    const { data } = await supabase.from('quote_line_items').select('id, description, quantity, unit_price').eq('quote_id', row.id).order('sort_order')
    setFormLines((data && data.length) ? data : [emptyLine()])
    setShowForm(true)
  }

  const updateLine = (i, patch) => setFormLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const addLine = () => setFormLines((prev) => [...prev, emptyLine()])
  const removeLine = (i) => setFormLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)))
  const formTotal = formLines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    if (!formCustomerId) { setFormError('Select a customer.'); return }
    const cleanLines = formLines.filter((l) => l.description.trim() && Number(l.quantity) > 0)
    if (cleanLines.length === 0) { setFormError('Add at least one line item.'); return }

    setSaving(true)
    let quoteNumber = formNumber.trim()
    if (!quoteNumber && !editingId) {
      const { data: autoNumber, error: numErr } = await supabase.rpc('next_quote_number', { p_firm_id: firmId })
      if (numErr) { setSaving(false); setFormError(numErr.message); return }
      quoteNumber = autoNumber
    }

    const payload = {
      customer_id: formCustomerId,
      quote_no: quoteNumber || formNumber.trim(),
      issued_date: formIssuedDate,
      valid_until: formValidUntil || null,
      notes: formNotes.trim() || null,
    }

    let quoteId = editingId
    if (editingId) {
      const { error: err } = await supabase.from('quotes').update(payload).eq('id', editingId)
      if (err) { setSaving(false); setFormError(err.message); return }
      await supabase.from('quote_line_items').delete().eq('quote_id', editingId)
    } else {
      const { data, error: err } = await supabase.from('quotes').insert({ firm_id: firmId, status: 'draft', ...payload }).select('id').single()
      if (err) { setSaving(false); setFormError(err.message); return }
      quoteId = data.id
    }

    const { error: linesErr } = await supabase.from('quote_line_items').insert(
      cleanLines.map((l, i) => ({
        quote_id: quoteId,
        description: l.description.trim(),
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        sort_order: i,
      }))
    )
    setSaving(false)
    if (linesErr) { setFormError(linesErr.message); return }
    resetForm()
    setShowForm(false)
    load()
  }

  const handleMarkStatus = async (row, status) => {
    setBusyId(row.id)
    const { error: err } = await supabase.from('quotes').update({ status }).eq('id', row.id)
    setBusyId(null)
    if (err) { alert(`Couldn't update that quote: ${err.message}`); return }
    load()
  }

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete quote ${row.quote_no}? This cannot be undone.`)) return
    setBusyId(row.id)
    const { error: err } = await supabase.from('quotes').delete().eq('id', row.id)
    setBusyId(null)
    if (err) { alert(`Couldn't delete that quote: ${err.message}`); return }
    load()
  }

  const handleConvert = async (row) => {
    if (!window.confirm(`Convert ${row.quote_no} to a sales invoice for ${inr(row.total)}?`)) return
    setBusyId(row.id)
    const { data: invoiceNumber, error: numErr } = await supabase.rpc('next_sales_invoice_number', { p_firm_id: firmId })
    if (numErr) { setBusyId(null); alert(`Couldn't generate an invoice number: ${numErr.message}`); return }

    const { data: invoice, error: invErr } = await supabase.from('sales_invoices').insert({
      firm_id: firmId,
      customer_id: row.customer_id,
      invoice_no: invoiceNumber,
      issued_date: toISODate(new Date()),
      due_date: null,
      amount: row.total,
      paid_amount: 0,
      status: 'Sent',
    }).select('id').single()
    if (invErr) { setBusyId(null); alert(`Couldn't create the invoice: ${invErr.message}`); return }

    const { error: updateErr } = await supabase.from('quotes').update({ status: 'converted', converted_invoice_id: invoice.id }).eq('id', row.id)
    setBusyId(null)
    if (updateErr) { alert(`Invoice ${invoiceNumber} was created, but marking the quote as converted failed: ${updateErr.message}`); load(); return }
    load()
  }

  const handleDownloadPdf = async (row) => {
    const { data } = await supabase.from('quote_line_items').select('description, quantity, unit_price, amount').eq('quote_id', row.id).order('sort_order')
    downloadQuotePdf({
      firm: firm || {},
      party: customerById(row.customer_id),
      quote: { number: row.quote_no, issued_date: row.issued_date, valid_until: row.valid_until, status: displayStatus(row) },
      lineItems: data || [],
    })
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title="Quotations" note="estimates you send before the sale - convert to an invoice once accepted" />

      <div className="card">
        <div className="section-header" style={{ marginBottom: showForm ? 12 : 8 }}>
          <span className="section-header__note">{filtered.length} quote{filtered.length !== 1 ? 's' : ''}</span>
          <button
            className="link-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => (showForm && !editingId ? setShowForm(false) : openCreateForm())}
            disabled={customers.length === 0}
            title={customers.length === 0 ? 'Add a customer first (Sales screen)' : undefined}
          >
            <Plus size={14} /> New quote
          </button>
        </div>

        {customers.length === 0 && !showForm && (
          <p className="login-footnote" style={{ marginTop: -4, marginBottom: 12 }}>
            Add a customer on the Sales screen before creating a quote.
          </p>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="add-comm-form" style={{ marginBottom: 16 }}>
            <div className="drawer__label" style={{ marginBottom: -4 }}>{editingId ? 'Editing quote' : 'New quote'}</div>
            <div className="add-comm-row">
              <select className="select select--sm" value={formCustomerId} onChange={(e) => setFormCustomerId(e.target.value)}>
                <option value="">Select customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="text-input" placeholder="Quote # (blank = auto-number)" value={formNumber} onChange={(e) => setFormNumber(e.target.value)} />
            </div>
            <div className="add-comm-row">
              <div style={{ flex: 1 }}>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Issued date</label>
                <input type="date" className="text-input" value={formIssuedDate} onChange={(e) => setFormIssuedDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Valid until (optional)</label>
                <input type="date" className="text-input" value={formValidUntil} onChange={(e) => setFormValidUntil(e.target.value)} />
              </div>
            </div>

            <div className="table-scroll">
              <table className="ledger-table">
                <thead>
                  <tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th></th></tr>
                </thead>
                <tbody>
                  {formLines.map((line, i) => (
                    <tr key={i} className="ledger-row">
                      <td><input className="text-input" value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} /></td>
                      <td className="num"><input type="number" min="0" step="1" className="text-input" style={{ textAlign: 'right', maxWidth: 70 }} value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></td>
                      <td className="num"><input type="number" min="0" step="0.01" className="text-input" style={{ textAlign: 'right', maxWidth: 100 }} value={line.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} /></td>
                      <td className="num mono">{inr((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}</td>
                      <td>{formLines.length > 1 && <button type="button" className="link-btn" onClick={() => removeLine(i)}>Remove</button>}</td>
                    </tr>
                  ))}
                  <tr className="ledger-row">
                    <td colSpan={3}><button type="button" className="link-btn" onClick={addLine}>+ Add line</button></td>
                    <td className="num" style={{ fontWeight: 600 }}>{inr(formTotal)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <textarea className="textarea" rows={2} placeholder="Notes (optional - terms, scope, etc.)" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />

            {formError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{formError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add quote'}</button>
              <button type="button" className="link-btn" onClick={() => { resetForm(); setShowForm(false) }}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search quote # or customer...' }}
        filters={[
          { label: 'Customer', value: customerFilter, onChange: setCustomerFilter, options: [{ value: 'all', label: 'All' }, ...customers.map((c) => ({ value: c.id, label: c.name }))] },
          { label: 'Status', value: statusFilter, onChange: setStatusFilter, options: [{ value: 'all', label: 'All' }, ...STATUS_OPTIONS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))] },
        ]}
        period={{ value: period, onChange: setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }}
        sort={{ value: sortBy, onChange: setSortBy, options: [
          { value: 'date-desc', label: 'Newest first' }, { value: 'date-asc', label: 'Oldest first' },
          { value: 'amount-desc', label: 'Amount: high to low' }, { value: 'amount-asc', label: 'Amount: low to high' },
        ] }}
        exportOptions={{ onExcel: handleExportCsv, onPdf: handleExportPdf, onWord: handleExportWord, disabled: filtered.length === 0 }}
      />

      <div className="card">
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr><th>Quote</th><th>Customer</th><SortableTh label="Issued" ascValue="date-asc" descValue="date-desc" sortBy={sortBy} onSort={setSortBy} /><SortableTh label="Total" ascValue="amount-asc" descValue="amount-desc" sortBy={sortBy} onSort={setSortBy} className="num" /><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const status = displayStatus(r)
                const busy = busyId === r.id
                return (
                  <tr key={r.id} className="ledger-row">
                      <td className="mono">{r.quote_no}</td>
                      <td>{customerName(r.customer_id)}</td>
                      <td className="mono">{toISODate(new Date(r.issued_date))}</td>
                      <td className="num mono">{inr(r.total)}</td>
                      <td><span className={STATUS_PILL[status]}>{status}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {(status === 'draft' || status === 'sent' || status === 'expired') && (
                          <>
                            <button className="link-btn" disabled={busy} onClick={() => openEditForm(r)}>Edit</button>
                            {status === 'draft' && <button className="link-btn" disabled={busy} onClick={() => handleMarkStatus(r, 'sent')}>Mark Sent</button>}
                            <button className="link-btn" disabled={busy} onClick={() => handleMarkStatus(r, 'accepted')}>Accept</button>
                            <button className="link-btn" disabled={busy} onClick={() => handleMarkStatus(r, 'declined')}>Decline</button>
                            <button className="link-btn" style={{ color: 'var(--brick)' }} disabled={busy} onClick={() => handleDelete(r)}>Delete</button>
                          </>
                        )}
                        {status === 'accepted' && (
                          <button className="link-btn" disabled={busy} onClick={() => handleConvert(r)}>{busy ? 'Converting…' : 'Convert to Invoice'}</button>
                        )}
                        {status === 'declined' && (
                          <button className="link-btn" style={{ color: 'var(--brick)' }} disabled={busy} onClick={() => handleDelete(r)}>Delete</button>
                        )}
                        <button className="link-btn" onClick={() => handleDownloadPdf(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Download size={12} /> PDF
                        </button>
                      </td>
                    </tr>
                )
              })}
              {filtered.length === 0 && <EmptyRow colSpan={6}>No quotes match these filters.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
