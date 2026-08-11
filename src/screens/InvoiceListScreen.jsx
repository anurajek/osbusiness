import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, toISODate, computeStatus, statusForStorage } from '../lib/format'
import { previewDocumentPdf, downloadListPdf, itemTaxFieldsFromRow } from '../lib/pdf'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListDocx } from '../lib/exportDocx'
import PdfPreviewModal from '../components/PdfPreviewModal'
import { FilterBar, SORT_OPTIONS_DATE_AMOUNT, sortRows } from '../components/FilterControls'
import { StatusPill, SectionHeader, EmptyRow, SortableTh } from '../components/ui'

// Full list of statuses a record can ever show as (computed live, not stored).
const ALL_STATUSES = ['Paid', 'Partial', 'Due today', 'Overdue'] // base status (Sent/Approved) added per-type below

export default function InvoiceListScreen({ type, onNavigate }) {
  const { firmId, firm } = useFirm()
  const isSales = type === 'sales'
  const baseStatus = isSales ? 'Sent' : 'Approved'
  const statusOptions = [baseStatus, ...ALL_STATUSES, 'Cancelled']
  const partyLabel = isSales ? 'customer' : 'supplier'
  const docLabel = isSales ? 'invoice' : 'bill'

  const [rows, setRows] = useState([])
  const [parties, setParties] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
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
  const [newPartyAddress, setNewPartyAddress] = useState('')
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
  const [addingDoc, setAddingDoc] = useState(false)
  const [addDocError, setAddDocError] = useState(null)

  const [payingId, setPayingId] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payAccountId, setPayAccountId] = useState('')
  const [payDate, setPayDate] = useState(() => toISODate(new Date()))
  const [payingBusy, setPayingBusy] = useState(false)
  const [payError, setPayError] = useState(null)

  // Sales-only: an explicit "this invoice is the real Tax Invoice that PI
  // became" link, created manually once the real invoice has been
  // imported. Linking carries the PI's payment over automatically - see
  // handleLinkToPi below.
  const [linkingId, setLinkingId] = useState(null)
  const [availablePis, setAvailablePis] = useState([])
  const [selectedPiId, setSelectedPiId] = useState('')
  const [linkingBusy, setLinkingBusy] = useState(false)
  const [linkError, setLinkError] = useState(null)

  const partyTable = isSales ? 'customers' : 'suppliers'
  const table = isSales ? 'sales_invoices' : 'purchase_bills'
  const partyJoinKey = isSales ? 'customer_id' : 'supplier_id'
  const numberField = isSales ? 'invoice_no' : 'bill_no'

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)

    const { data: partyRows, error: partyErr } = await supabase
      .from(partyTable).select('id, name, gstin, address, email').eq('firm_id', firmId).order('name')

    const { data: acctRows, error: acctErr } = await supabase
      .from('bank_accounts').select('id, name, account_mask, balance').eq('firm_id', firmId).order('name')

    const { data: invoiceRows, error: invErr } = await supabase
      .from(table)
      .select(`id, ${numberField}, ${partyJoinKey}, issued_date, due_date, amount, paid_amount, status, is_cancelled, item_description, item_quantity, item_rate, subtotal, discount_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount${isSales ? ', linked_pi_id' : ''}`)
      .eq('firm_id', firmId)
      .order('issued_date', { ascending: false })

    if (partyErr || acctErr || invErr) {
      setError((partyErr || acctErr || invErr).message)
      setLoading(false)
      return
    }
    setParties(partyRows ?? [])
    setBankAccounts(acctRows ?? [])
    setRows(invoiceRows ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, isSales])

  useEffect(() => { load() }, [load])

  const partyName = (id) => parties.find((p) => p.id === id)?.name || '—'
  const partyById = (id) => parties.find((p) => p.id === id) || null
  const range = getPeriodRange(period, customFrom, customTo)
  const liveStatus = (r) => (r.is_cancelled ? 'Cancelled' : computeStatus(r, baseStatus))

  const [preview, setPreview] = useState(null)

  const handlePreviewPdf = async (row) => {
    const { url, filename } = await previewDocumentPdf({
      firm: firm || {},
      party: partyById(row[partyJoinKey]),
      doc: {
        number: row[numberField],
        issued_date: row.issued_date,
        due_date: row.due_date,
        amount: row.amount,
        paid_amount: row.paid_amount,
        status: liveStatus(row),
        isSales,
        ...itemTaxFieldsFromRow(row),
      },
    })
    setPreview({ url, filename })
  }

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  // Cancelling isn't "delete," it's "this is void, stop counting it toward
  // what's owed" while keeping the record (and whatever payment history it
  // has) intact and visible via the Status filter. See lib/format.js's
  // isResolved(), used consistently everywhere a pending total is computed
  // (Receivables, Payables, Invoice/PI Follow-up) so a cancelled document
  // never contributes anywhere, not just here.
  const handleToggleCancelled = async (row) => {
    const willCancel = !row.is_cancelled
    const owedPhrase = isSales ? "what this customer owes you" : "what you owe this supplier"
    if (willCancel && !window.confirm(`Cancel ${row[numberField]}? It'll stop counting toward ${owedPhrase}, but stays on record.`)) return
    const { error: err } = await supabase.from(table).update({ is_cancelled: willCancel }).eq('id', row.id)
    if (err) { alert(`Couldn't update that: ${err.message}`); return }
    load()
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (range) {
      list = list.filter((r) => {
        const d = new Date(r.issued_date)
        return d >= range.from && d <= range.to
      })
    }
    if (partyFilter !== 'all') list = list.filter((r) => r[partyJoinKey] === partyFilter)
    if (statusFilter !== 'all') list = list.filter((r) => liveStatus(r) === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (r) => r[numberField]?.toLowerCase().includes(q) || partyName(r[partyJoinKey]).toLowerCase().includes(q)
      )
    }
    return sortRows(list, sortBy, 'issued_date')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range, partyFilter, statusFilter, search, sortBy, parties])

  const handleExportCsv = () => {
    downloadCsv(
      `${isSales ? 'sales-invoices' : 'purchase-bills'}`,
      [isSales ? 'Invoice #' : 'Bill #', isSales ? 'Customer' : 'Supplier', 'Issued', 'Due Date', 'Amount', 'Paid', 'Balance', 'Status'],
      filtered.map((r) => [
        r[numberField],
        partyName(r[partyJoinKey]),
        r.issued_date,
        r.due_date || '',
        r.amount.toFixed(2),
        r.paid_amount.toFixed(2),
        (r.amount - r.paid_amount).toFixed(2),
        liveStatus(r),
      ])
    )
  }

  const handleExportPdf = () => {
    downloadListPdf({
      title: isSales ? 'Sales Invoices' : 'Purchase Bills',
      firm,
      filename: isSales ? 'sales-invoices' : 'purchase-bills',
      columns: [
        { label: isSales ? 'Invoice #' : 'Bill #' }, { label: isSales ? 'Customer' : 'Supplier' }, { label: 'Issued' },
        { label: 'Amount', align: 'right' }, { label: 'Paid', align: 'right' }, { label: 'Balance', align: 'right' }, { label: 'Status' },
      ],
      rows: filtered.map((r) => [
        r[numberField],
        partyName(r[partyJoinKey]),
        r.issued_date,
        inr(r.amount),
        inr(r.paid_amount),
        inr(r.amount - r.paid_amount),
        liveStatus(r),
      ]),
    })
  }

  const handleExportWord = () => {
    downloadListDocx({
      title: isSales ? 'Sales Invoices' : 'Purchase Bills',
      firm,
      filename: isSales ? 'sales-invoices' : 'purchase-bills',
      columns: [
        { label: isSales ? 'Invoice #' : 'Bill #' }, { label: isSales ? 'Customer' : 'Supplier' }, { label: 'Issued' },
        { label: 'Amount', align: 'right' }, { label: 'Paid', align: 'right' }, { label: 'Balance', align: 'right' }, { label: 'Status' },
      ],
      rows: filtered.map((r) => [
        r[numberField],
        partyName(r[partyJoinKey]),
        r.issued_date,
        inr(r.amount),
        inr(r.paid_amount),
        inr(r.amount - r.paid_amount),
        liveStatus(r),
      ]),
    })
  }

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
      address: newPartyAddress.trim() || null,
    })
    setAddingParty(false)
    if (err) { setAddPartyError(err.message); return }
    setNewPartyName(''); setNewPartyGstin(''); setNewPartyContact(''); setNewPartyAddress('')
    setShowAddParty(false)
    load()
  }

  const resetDocForm = () => {
    setEditingDocId(null)
    setNewDocPartyId(''); setNewDocNumber('')
    setNewDocIssuedDate(toISODate(new Date())); setNewDocDueDate('')
    setNewDocAmount(''); setNewDocPaid('0')
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
    setShowAddDoc(true)
  }

  // Live preview of what status this record will show as, based on what's
  // currently typed into the form - updates as you type, nothing to pick.
  const formPreviewStatus = useMemo(() => {
    return computeStatus(
      { amount: newDocAmount, paid_amount: newDocPaid, due_date: newDocDueDate },
      baseStatus
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDocAmount, newDocPaid, newDocDueDate])

  const handleAddDoc = async (e) => {
    e.preventDefault()
    setAddDocError(null)

    if (!newDocPartyId) { setAddDocError(`Select a ${partyLabel}.`); return }
    let docNumber = newDocNumber.trim()
    if (!docNumber && !isSales) { setAddDocError(`Enter a ${docLabel} number.`); return }
    const amountNum = parseFloat(newDocAmount)
    if (!amountNum || amountNum <= 0) { setAddDocError('Enter a valid amount.'); return }
    const paidNum = parseFloat(newDocPaid) || 0

    setAddingDoc(true)

    // Sales invoices can be auto-numbered from the firm's own prefix/counter
    // (see migration_branding_numbering.sql) - only kicks in if left blank,
    // so typing your own number always takes precedence.
    if (!docNumber && isSales) {
      const { data: autoNumber, error: numErr } = await supabase.rpc('next_sales_invoice_number', { p_firm_id: firmId })
      if (numErr) { setAddingDoc(false); setAddDocError(numErr.message); return }
      docNumber = autoNumber
    }

    const computed = computeStatus({ amount: amountNum, paid_amount: paidNum, due_date: newDocDueDate }, baseStatus)
    const payload = {
      [partyJoinKey]: newDocPartyId,
      [numberField]: docNumber,
      issued_date: newDocIssuedDate,
      due_date: newDocDueDate || null,
      amount: amountNum,
      paid_amount: paidNum,
      status: statusForStorage(computed, isSales),
    }

    const { error: err } = editingDocId
      ? await supabase.from(table).update(payload).eq('id', editingDocId)
      : await supabase.from(table).insert({ firm_id: firmId, ...payload })

    if (!err) {
      await supabase.from('activity_log').insert({
        firm_id: firmId,
        description: `${isSales ? 'Sales invoice' : 'Purchase bill'} ${docNumber} ${editingDocId ? 'updated' : 'added'} for ${partyName(newDocPartyId)} — ${inr(amountNum)}`,
      })
    }

    setAddingDoc(false)
    if (err) { setAddDocError(err.message); return }
    resetDocForm()
    setShowAddDoc(false)
    load()
  }

  // Lightweight one-click action for the most common update of all: "the
  // customer paid X" / "I paid the supplier X" - no need to open the full
  // edit form just to bump paid_amount. Status recalculates automatically.
  const openPayForm = (row) => {
    setPayingId(row.id)
    setPayAmount('')
    setPayAccountId(bankAccounts[0]?.id || '')
    setPayDate(toISODate(new Date()))
    setPayError(null)
  }

  const handleRecordPayment = async (row) => {
    setPayError(null)
    const extra = parseFloat(payAmount)
    if (!extra || extra <= 0) { setPayError('Enter a valid amount.'); return }
    if (!payAccountId) { setPayError('Select which cash or bank account this moved through.'); return }
    if (!payDate) { setPayError('Pick the date this payment was actually received/made.'); return }

    const account = bankAccounts.find((a) => a.id === payAccountId)
    if (!account) { setPayError('That account could not be found - try reopening this form.'); return }

    const newPaid = Math.min((Number(row.paid_amount) || 0) + extra, row.amount)
    const computed = computeStatus({ amount: row.amount, paid_amount: newPaid, due_date: row.due_date }, baseStatus)
    // Sales: money comes in (credit, balance up). Purchases: money goes out (debit, balance down).
    const txnAmount = isSales ? extra : -extra

    setPayingBusy(true)

    const { error: invErr } = await supabase
      .from(table)
      .update({ paid_amount: newPaid, status: statusForStorage(computed, isSales) })
      .eq('id', row.id)

    let txnErr = null
    let acctErr = null
    if (!invErr) {
      const txnResult = await supabase.from('bank_transactions').insert({
        firm_id: firmId,
        bank_account_id: payAccountId,
        txn_date: payDate,
        description: `Payment ${isSales ? 'received' : 'made'} — ${row[numberField]} (${partyName(row[partyJoinKey])})`,
        amount: txnAmount,
        reconciled: true,
        related_sales_invoice_id: isSales ? row.id : null,
        related_purchase_bill_id: isSales ? null : row.id,
      })
      txnErr = txnResult.error

      if (!txnErr) {
        const acctResult = await supabase
          .from('bank_accounts')
          .update({ balance: Number(account.balance) + txnAmount })
          .eq('id', payAccountId)
        acctErr = acctResult.error
      }

      if (!txnErr && !acctErr) {
        await supabase.from('activity_log').insert({
          firm_id: firmId,
          description: `Payment of ${inr(extra)} recorded on ${row[numberField]} (${partyName(row[partyJoinKey])}) via ${account.name}`,
        })
      }
    }

    setPayingBusy(false)

    if (invErr) { setPayError(invErr.message); return }
    if (txnErr || acctErr) {
      setPayError(
        `The invoice was updated, but recording the ${account.name} transaction failed: ${(txnErr || acctErr).message}. ` +
        `Check Cash & Bank and add it manually if needed.`
      )
      load()
      return
    }

    setPayingId(null)
    load()
  }

  // Sales-only: pulls this customer's non-cancelled PIs to pick from -
  // any state, not just pending ones, since the point is finding the PI
  // that actually corresponds to this invoice, which could be fully paid,
  // tagged, or still open.
  const openLinkForm = async (row) => {
    setLinkingId(row.id)
    setSelectedPiId('')
    setLinkError(null)
    setAvailablePis([])
    const { data, error: err } = await supabase.from('proforma_invoices')
      .select('id, pi_no, issued_date, amount, paid_amount')
      .eq('firm_id', firmId)
      .eq('customer_id', row[partyJoinKey])
      .eq('is_cancelled', false)
      .order('issued_date', { ascending: false })
    if (err) { setLinkError(err.message); return }
    setAvailablePis(data ?? [])
  }

  // Links this invoice to the PI it's the real conversion of, and carries
  // the PI's payment over - only when the invoice doesn't already have its
  // own payment recorded, so real data here is never silently overwritten.
  // Re-points (not duplicates) the PI's existing bank transaction to the
  // invoice instead, since the cash was only ever received once - and
  // that transaction's original date becomes a real, correct data point
  // for the DSO days-to-collect trend on this invoice going forward.
  const handleLinkToPi = async (row) => {
    if (!selectedPiId) { setLinkError('Pick a Proforma Invoice to link.'); return }
    const pi = availablePis.find((p) => p.id === selectedPiId)
    if (!pi) { setLinkError('That PI could not be found - try reopening this.'); return }

    setLinkingBusy(true)
    setLinkError(null)

    const updates = { linked_pi_id: pi.id }
    const carryingPayment = Number(row.paid_amount || 0) === 0 && Number(pi.paid_amount || 0) > 0
    if (carryingPayment) updates.paid_amount = Math.min(Number(pi.paid_amount), Number(row.amount))

    const { error: invErr } = await supabase.from('sales_invoices').update(updates).eq('id', row.id)
    if (invErr) { setLinkingBusy(false); setLinkError(invErr.message); return }

    if (carryingPayment) {
      const { error: txnErr } = await supabase.from('bank_transactions')
        .update({ related_sales_invoice_id: row.id, related_proforma_invoice_id: null })
        .eq('related_proforma_invoice_id', pi.id)
      if (txnErr) {
        setLinkingBusy(false)
        setLinkError(`Linked, but re-pointing the existing payment record failed: ${txnErr.message}. Check Cash & Bank.`)
        load()
        return
      }
    }

    // Tags the PI "Invoiced" as a courtesy - that's exactly what linking
    // means (this PI has now definitively been converted), overwriting
    // whatever tag was there before since linking is a stronger, more
    // specific signal than any manual tag set earlier.
    await supabase.from('proforma_invoices').update({ manual_status: 'Invoiced' }).eq('id', pi.id)

    setLinkingBusy(false)
    setLinkingId(null)
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

      {showAddParty && (
        <div className="card">
          <form onSubmit={handleAddParty} className="add-comm-form">
            <div className="add-comm-row">
              <input className="text-input" placeholder="Name" value={newPartyName} onChange={(e) => setNewPartyName(e.target.value)} />
              <input className="text-input" placeholder="GSTIN (optional)" value={newPartyGstin} onChange={(e) => setNewPartyGstin(e.target.value)} />
              <input className="text-input" placeholder="Contact (optional)" value={newPartyContact} onChange={(e) => setNewPartyContact(e.target.value)} />
            </div>
            <div className="add-comm-row">
              <input className="text-input" placeholder="Address (optional - shown on invoice/bill PDFs)" value={newPartyAddress} onChange={(e) => setNewPartyAddress(e.target.value)} />
            </div>
            {addPartyError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{addPartyError}</p>}
            <div className="add-comm-row">
              <button className="btn-primary" disabled={addingParty}>{addingParty ? 'Adding…' : `Add ${partyLabel}`}</button>
              <button type="button" className="link-btn" onClick={() => setShowAddParty(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <FilterBar
        addAction={{ label: `Add ${partyLabel}`, onClick: () => setShowAddParty((v) => !v) }}
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
        period={{ value: period, onChange: setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }}
        sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS_DATE_AMOUNT }}
        exportOptions={{ onExcel: handleExportCsv, onPdf: handleExportPdf, onWord: handleExportWord, disabled: filtered.length === 0 }}
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
            <div className="drawer__label" style={{ marginBottom: -4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{editingDocId ? `Editing ${docLabel}` : `New ${docLabel}`}</span>
              <span className="comm-tag">Status: {formPreviewStatus}</span>
            </div>
            <div className="add-comm-row">
              <select className="select select--sm" value={newDocPartyId} onChange={(e) => setNewDocPartyId(e.target.value)}>
                <option value="">{isSales ? 'Select customer' : 'Select supplier'}</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input
                className="text-input"
                placeholder={isSales ? 'Invoice # (blank = auto-number)' : 'Bill # (e.g. PB-2240)'}
                value={newDocNumber}
                onChange={(e) => setNewDocNumber(e.target.value)}
              />
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
                <input
                  type="number" min="0" step="0.01" className="text-input"
                  value={newDocPaid}
                  onChange={(e) => setNewDocPaid(e.target.value)}
                  placeholder="0.00"
                  disabled={!!editingDocId}
                  title={editingDocId ? "Use \"Record payment\" to change this so Cash & Bank stays in sync" : undefined}
                />
              </div>
            </div>
            <p className="login-footnote" style={{ margin: 0 }}>
              Status is calculated automatically from the amount paid and the due date — nothing to set manually.
              {editingDocId
                ? ' "Already paid" can only be changed via "Record payment" (or by deleting the matching entry in Cash & Bank), so the cash ledger never drifts out of sync with what an invoice/bill says was paid.'
                : ' Only set "Already paid" here for a historical record that was paid before you started tracking it in Cash & Bank — it won\'t create a transaction. For anything going forward, leave it at 0 and use "Record payment" instead.'}
            </p>
            {addDocError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{addDocError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" disabled={addingDoc}>
                {addingDoc ? 'Saving…' : editingDocId ? 'Save changes' : `Add ${docLabel}`}
              </button>
              <button type="button" className="link-btn" onClick={() => { resetDocForm(); setShowAddDoc(false) }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>{isSales ? 'Invoice' : 'Bill'}</th>
              <th>{isSales ? 'Customer' : 'Supplier'}</th>
              <SortableTh label="Issued" ascValue="date-asc" descValue="date-desc" sortBy={sortBy} onSort={setSortBy} />
              <SortableTh label="Amount" ascValue="amount-asc" descValue="amount-desc" sortBy={sortBy} onSort={setSortBy} className="num" />
              <th className="num">Paid</th>
              <th className="num">Balance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const status = liveStatus(r)
              const fullyPaid = status === 'Paid'
              return (
                <Fragment key={r.id}>
                  <tr className="ledger-row">
                    <td className="mono">{r[numberField]}</td>
                    <td>
                      {onNavigate ? (
                        <button
                          className="link-btn" style={{ padding: 0, textAlign: 'left', color: 'inherit', textDecoration: 'underline', textDecorationColor: 'var(--rule)' }}
                          title={`View ${partyName(r[partyJoinKey])} in ${isSales ? 'Receivables' : 'Payables'}`}
                          onClick={() => onNavigate('arap', isSales ? 'receivables' : 'payables', isSales ? { customerId: r[partyJoinKey] } : { supplierId: r[partyJoinKey] })}
                        >
                          {partyName(r[partyJoinKey])}
                        </button>
                      ) : partyName(r[partyJoinKey])}
                    </td>
                    <td className="mono">{r.issued_date ? toISODate(new Date(r.issued_date)) : '—'}</td>
                    <td className="num mono">{inr(r.amount)}</td>
                    <td className="num mono">{inr(r.paid_amount)}</td>
                    <td className={`num mono ${r.amount - r.paid_amount > 0 ? 'amt-neg' : ''}`}>{inr(r.amount - r.paid_amount)}</td>
                    <td><StatusPill status={status} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <select
                        className="select select--sm"
                        value=""
                        onChange={(e) => {
                          const action = e.target.value
                          if (action === 'pay') openPayForm(r)
                          else if (action === 'edit') openEditForm(r)
                          else if (action === 'preview') handlePreviewPdf(r)
                          else if (action === 'cancel') handleToggleCancelled(r)
                          else if (action === 'link-pi') openLinkForm(r)
                          else if (action === 'receivables') onNavigate?.('arap', 'receivables', { customerId: r[partyJoinKey] })
                          else if (action === 'payables') onNavigate?.('arap', 'payables', { supplierId: r[partyJoinKey] })
                          else if (action === 'invoice-followup') onNavigate?.('arap', 'invoice-followup', { customerId: r[partyJoinKey] })
                          else if (action === 'pi-followup') onNavigate?.('arap', 'pi-followup', { customerId: r[partyJoinKey] })
                        }}
                      >
                        <option value="" disabled>Actions…</option>
                        {!fullyPaid && <option value="pay">Record payment</option>}
                        <option value="edit">Edit</option>
                        <option value="preview">Preview</option>
                        <option value="cancel">{r.is_cancelled ? `Reinstate ${docLabel}` : `Cancel ${docLabel}`}</option>
                        {isSales && <option value="link-pi">{r.linked_pi_id ? 'Change linked PI…' : 'Link to PI…'}</option>}
                        {onNavigate && isSales && <option value="receivables">Receivables →</option>}
                        {onNavigate && !isSales && <option value="payables">Payables →</option>}
                        {onNavigate && isSales && <option value="invoice-followup">Invoice Follow-up →</option>}
                        {onNavigate && isSales && <option value="pi-followup">PI Follow-up →</option>}
                      </select>
                    </td>
                  </tr>
                  {payingId === r.id && (
                    <tr>
                      <td colSpan={8} style={{ padding: '10px', background: 'var(--panel-alt)' }}>
                        <div className="add-comm-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="text-[12.5px]" style={{ color: 'var(--paper-dim)', whiteSpace: 'nowrap' }}>
                            {inr(r.amount - r.paid_amount)} still due
                          </span>
                          <input
                            type="number" min="0" step="0.01" className="text-input pay-amount-input"
                            value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Amount received" autoFocus
                          />
                          <input
                            type="date" className="date-input"
                            value={payDate} onChange={(e) => setPayDate(e.target.value)}
                            title="Date this payment actually happened"
                          />
                          <select className="select select--sm pay-account-select" value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)}>
                            <option value="">{isSales ? 'Received into...' : 'Paid from...'}</option>
                            {bankAccounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.name} {a.account_mask ? `(${a.account_mask})` : ''}</option>
                            ))}
                          </select>
                          <button className="btn-primary" disabled={payingBusy} onClick={() => handleRecordPayment(r)}>
                            {payingBusy ? 'Saving…' : 'Save payment'}
                          </button>
                          <button className="link-btn" onClick={() => setPayingId(null)}>Cancel</button>
                        </div>
                        {bankAccounts.length === 0 && (
                          <p className="login-footnote" style={{ marginTop: 6 }}>
                            No cash/bank accounts set up yet — add one on the Cash & Bank screen first.
                          </p>
                        )}
                        {payError && <p className="text-[12.5px]" style={{ color: 'var(--brick)', marginTop: 6 }}>{payError}</p>}
                      </td>
                    </tr>
                  )}
                  {linkingId === r.id && (
                    <tr>
                      <td colSpan={8} style={{ padding: '10px', background: 'var(--panel-alt)' }}>
                        <div className="add-comm-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <select className="select" value={selectedPiId} onChange={(e) => setSelectedPiId(e.target.value)}>
                            <option value="" disabled>Select the Proforma Invoice this became…</option>
                            {availablePis.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.pi_no} · {toISODate(new Date(p.issued_date))} · {inr(p.amount)} ({inr(p.paid_amount)} paid)
                              </option>
                            ))}
                          </select>
                          <button className="btn-primary" disabled={linkingBusy || availablePis.length === 0} onClick={() => handleLinkToPi(r)}>
                            {linkingBusy ? 'Linking…' : 'Link'}
                          </button>
                          <button className="link-btn" onClick={() => setLinkingId(null)}>Cancel</button>
                        </div>
                        {availablePis.length === 0 && !linkError && (
                          <p className="login-footnote" style={{ marginTop: 6 }}>
                            No Proforma Invoices found for {partyName(r[partyJoinKey])}.
                          </p>
                        )}
                        {Number(r.paid_amount || 0) > 0 && (
                          <p className="login-footnote" style={{ marginTop: 6 }}>
                            This invoice already has a payment recorded ({inr(r.paid_amount)}) - linking won't overwrite it, so the PI's payment won't be carried over automatically. Record it manually if that's not what already happened here.
                          </p>
                        )}
                        {linkError && <p className="text-[12.5px]" style={{ color: 'var(--brick)', marginTop: 6 }}>{linkError}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {filtered.length === 0 && <EmptyRow colSpan={8}>No records match these filters.</EmptyRow>}
          </tbody>
        </table>
        </div>
      </div>

      {preview && <PdfPreviewModal url={preview.url} filename={preview.filename} onClose={closePreview} />}
    </>
  )
}
