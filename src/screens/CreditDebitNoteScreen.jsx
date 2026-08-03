import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { Plus, Download } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, toISODate } from '../lib/format'
import { downloadNotePdf } from '../lib/pdf'
import { PeriodSelector, FilterBar, SORT_OPTIONS_DATE_AMOUNT, sortRows } from '../components/FilterControls'
import { EmptyRow, SortableTh } from '../components/ui'

// type: 'credit' (sales side - issued to a customer) or 'debit' (purchase
// side - issued to a supplier).
export default function CreditDebitNoteScreen({ type }) {
  const { firmId, firm } = useFirm()
  const isCredit = type === 'credit'
  const docLabel = isCredit ? 'Credit Note' : 'Debit Note'
  const partyLabel = isCredit ? 'customer' : 'supplier'

  const table = isCredit ? 'credit_notes' : 'debit_notes'
  const partyTable = isCredit ? 'customers' : 'suppliers'
  const partyJoinKey = isCredit ? 'customer_id' : 'supplier_id'
  const originalTable = isCredit ? 'sales_invoices' : 'purchase_bills'
  const originalJoinKey = isCredit ? 'original_invoice_id' : 'original_bill_id'
  const originalNumberField = isCredit ? 'invoice_no' : 'bill_no'
  const rpcName = isCredit ? 'next_credit_note_number' : 'next_debit_note_number'

  const [rows, setRows] = useState([])
  const [parties, setParties] = useState([])
  const [originalDocs, setOriginalDocs] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')
  const [search, setSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [formPartyId, setFormPartyId] = useState('')
  const [formOriginalId, setFormOriginalId] = useState('')
  const [formNumber, setFormNumber] = useState('')
  const [formIssuedDate, setFormIssuedDate] = useState(() => toISODate(new Date()))
  const [formReason, setFormReason] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  const [refundingId, setRefundingId] = useState(null)
  const [refundAccountId, setRefundAccountId] = useState('')
  const [refundDate, setRefundDate] = useState(() => toISODate(new Date()))
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundError, setRefundError] = useState(null)

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [partiesRes, originalRes, acctRes, notesRes] = await Promise.all([
      supabase.from(partyTable).select('id, name, gstin, address, email').eq('firm_id', firmId).order('name'),
      supabase.from(originalTable).select(`id, ${originalNumberField}, ${partyJoinKey}`).eq('firm_id', firmId).order(originalNumberField, { ascending: false }),
      supabase.from('bank_accounts').select('id, name, account_mask, balance').eq('firm_id', firmId).order('name'),
      supabase.from(table).select('*').eq('firm_id', firmId).order('issued_date', { ascending: false }),
    ])
    if (partiesRes.error || originalRes.error || acctRes.error || notesRes.error) {
      setError((partiesRes.error || originalRes.error || acctRes.error || notesRes.error).message)
      setLoading(false)
      return
    }
    setParties(partiesRes.data ?? [])
    setOriginalDocs(originalRes.data ?? [])
    setBankAccounts(acctRes.data ?? [])
    setRows(notesRes.data ?? [])
    setLoading(false)
  }, [firmId, table, partyTable, originalTable, originalNumberField, partyJoinKey])

  useEffect(() => { load() }, [load])

  const partyName = (id) => parties.find((p) => p.id === id)?.name || '—'
  const partyById = (id) => parties.find((p) => p.id === id) || null
  const originalNumber = (id) => originalDocs.find((d) => d.id === id)?.[originalNumberField] || null
  const range = getPeriodRange(period, customFrom, customTo)

  const filtered = useMemo(() => {
    let list = rows
    if (range) list = list.filter((r) => { const d = new Date(r.issued_date); return d >= range.from && d <= range.to })
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((r) => r.note_no?.toLowerCase().includes(q) || partyName(r[partyJoinKey]).toLowerCase().includes(q))
    }
    return sortRows(list, sortBy, 'issued_date')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range, statusFilter, search, sortBy, parties])

  const resetForm = () => {
    setFormPartyId(''); setFormOriginalId(''); setFormNumber('')
    setFormIssuedDate(toISODate(new Date())); setFormReason(''); setFormAmount('')
    setFormError(null)
  }

  const openCreateForm = () => { resetForm(); setShowForm(true) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    if (!formPartyId) { setFormError(`Select a ${partyLabel}.`); return }
    const amountNum = parseFloat(formAmount)
    if (!amountNum || amountNum <= 0) { setFormError('Enter a valid amount.'); return }

    setSaving(true)
    let noteNumber = formNumber.trim()
    if (!noteNumber) {
      const { data: autoNumber, error: numErr } = await supabase.rpc(rpcName, { p_firm_id: firmId })
      if (numErr) { setSaving(false); setFormError(numErr.message); return }
      noteNumber = autoNumber
    }

    const { error: err } = await supabase.from(table).insert({
      firm_id: firmId,
      [partyJoinKey]: formPartyId,
      [originalJoinKey]: formOriginalId || null,
      note_no: noteNumber,
      issued_date: formIssuedDate,
      reason: formReason.trim() || null,
      amount: amountNum,
      status: 'open',
    })
    setSaving(false)
    if (err) { setFormError(err.message); return }

    await supabase.from('activity_log').insert({
      firm_id: firmId,
      description: `${docLabel} ${noteNumber} issued for ${partyName(formPartyId)} — ${inr(amountNum)}`,
    })

    resetForm()
    setShowForm(false)
    load()
  }

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete ${docLabel.toLowerCase()} ${row.note_no}? This cannot be undone.`)) return
    setBusyId(row.id)
    const { error: err } = await supabase.from(table).delete().eq('id', row.id)
    setBusyId(null)
    if (err) { alert(`Couldn't delete that: ${err.message}`); return }
    load()
  }

  const openRefundForm = (row) => {
    setRefundingId(row.id)
    setRefundAccountId(bankAccounts[0]?.id || '')
    setRefundDate(toISODate(new Date()))
    setRefundError(null)
  }

  // Money direction is the opposite of what "credit vs debit" suggests at a
  // glance: a credit note pays money BACK TO a customer (cash out, same
  // direction as a purchase payment); a debit note gets money BACK FROM a
  // supplier (cash in, same direction as a sales payment). See the
  // migration file's header comment for the full reasoning.
  const handleRecordRefund = async (row) => {
    setRefundError(null)
    if (!refundAccountId) { setRefundError('Select which account the money moved through.'); return }
    if (!refundDate) { setRefundError('Pick the date this refund actually happened.'); return }
    const account = bankAccounts.find((a) => a.id === refundAccountId)
    if (!account) { setRefundError('That account could not be found - try reopening this form.'); return }

    const txnAmount = isCredit ? -row.amount : row.amount
    setRefundBusy(true)

    const { error: noteErr } = await supabase
      .from(table)
      .update({ status: 'refunded', refunded_via_account_id: refundAccountId, refunded_date: refundDate })
      .eq('id', row.id)

    let txnErr = null
    let acctErr = null
    if (!noteErr) {
      const txnResult = await supabase.from('bank_transactions').insert({
        firm_id: firmId,
        bank_account_id: refundAccountId,
        txn_date: refundDate,
        description: `${docLabel} refund — ${row.note_no} (${partyName(row[partyJoinKey])})`,
        amount: txnAmount,
        reconciled: true,
        related_credit_note_id: isCredit ? row.id : null,
        related_debit_note_id: isCredit ? null : row.id,
      })
      txnErr = txnResult.error

      if (!txnErr) {
        const acctResult = await supabase
          .from('bank_accounts')
          .update({ balance: Number(account.balance) + txnAmount })
          .eq('id', refundAccountId)
        acctErr = acctResult.error
      }

      if (!txnErr && !acctErr) {
        await supabase.from('activity_log').insert({
          firm_id: firmId,
          description: `${inr(row.amount)} refund recorded on ${docLabel.toLowerCase()} ${row.note_no} (${partyName(row[partyJoinKey])}) via ${account.name}`,
        })
      }
    }

    setRefundBusy(false)

    if (noteErr) { setRefundError(noteErr.message); return }
    if (txnErr || acctErr) {
      setRefundError(
        `The note was marked refunded, but recording the ${account.name} transaction failed: ${(txnErr || acctErr).message}. ` +
        `Check Cash & Bank and add it manually if needed.`
      )
      load()
      return
    }

    setRefundingId(null)
    load()
  }

  const handleDownloadPdf = (row) => {
    downloadNotePdf({
      firm: firm || {},
      party: partyById(row[partyJoinKey]),
      note: {
        number: row.note_no,
        issued_date: row.issued_date,
        reason: row.reason,
        amount: row.amount,
        status: row.status,
        isCreditNote: isCredit,
        originalDocNumber: originalNumber(row[originalJoinKey]),
      },
    })
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <div className="card">
        <div className="section-header" style={{ marginBottom: showForm ? 12 : 8 }}>
          <span className="section-header__note">{filtered.length} {docLabel.toLowerCase()}{filtered.length !== 1 ? 's' : ''}</span>
          <button
            className="link-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => (showForm ? setShowForm(false) : openCreateForm())}
            disabled={parties.length === 0}
            title={parties.length === 0 ? `Add a ${partyLabel} first` : undefined}
          >
            <Plus size={14} /> New {docLabel.toLowerCase()}
          </button>
        </div>

        {parties.length === 0 && !showForm && (
          <p className="login-footnote" style={{ marginTop: -4, marginBottom: 12 }}>
            Add a {partyLabel} on the {isCredit ? 'Sales' : 'Purchases'} screen first.
          </p>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="add-comm-form" style={{ marginBottom: 16 }}>
            <div className="add-comm-row">
              <select className="select select--sm" value={formPartyId} onChange={(e) => setFormPartyId(e.target.value)}>
                <option value="">{isCredit ? 'Select customer' : 'Select supplier'}</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="select select--sm" value={formOriginalId} onChange={(e) => setFormOriginalId(e.target.value)}>
                <option value="">{isCredit ? 'Related invoice (optional)' : 'Related bill (optional)'}</option>
                {originalDocs.filter((d) => !formPartyId || d[partyJoinKey] === formPartyId).map((d) => (
                  <option key={d.id} value={d.id}>{d[originalNumberField]}</option>
                ))}
              </select>
              <input className="text-input" placeholder="Note # (blank = auto-number)" value={formNumber} onChange={(e) => setFormNumber(e.target.value)} />
            </div>
            <div className="add-comm-row">
              <div style={{ flex: 1 }}>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Issued date</label>
                <input type="date" className="text-input" value={formIssuedDate} onChange={(e) => setFormIssuedDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--paper-dim)' }}>Amount (₹)</label>
                <input type="number" min="0" step="0.01" className="text-input" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <input className="text-input" placeholder="Reason (e.g. product return, billing correction)" value={formReason} onChange={(e) => setFormReason(e.target.value)} />
            {formError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{formError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : `Add ${docLabel.toLowerCase()}`}</button>
              <button type="button" className="link-btn" onClick={() => { resetForm(); setShowForm(false) }}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: `Search note # or ${partyLabel}...` }}
        filters={[
          { label: 'Status', value: statusFilter, onChange: setStatusFilter, options: [{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'refunded', label: 'Refunded' }] },
        ]}
        sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS_DATE_AMOUNT }}
      />

      <div className="card">
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Note</th>
                <th>{isCredit ? 'Customer' : 'Supplier'}</th>
                <SortableTh label="Issued" ascValue="date-asc" descValue="date-desc" sortBy={sortBy} onSort={setSortBy} />
                <th>Reason</th>
                <SortableTh label="Amount" ascValue="amount-asc" descValue="amount-desc" sortBy={sortBy} onSort={setSortBy} className="num" />
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Fragment key={r.id}>
                  <tr className="ledger-row">
                    <td className="mono">{r.note_no}</td>
                    <td>{partyName(r[partyJoinKey])}</td>
                    <td className="mono">{toISODate(new Date(r.issued_date))}</td>
                    <td>{r.reason || '—'}</td>
                    <td className="num mono">{inr(r.amount)}</td>
                    <td><span className={r.status === 'refunded' ? 'pill pill--ok' : 'pill pill--warn'}>{r.status === 'refunded' ? 'Refunded' : 'Open'}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'open' && (
                        <>
                          <button className="link-btn" onClick={() => openRefundForm(r)}>Record Refund</button>
                          <button className="link-btn" style={{ color: 'var(--brick)' }} disabled={busyId === r.id} onClick={() => handleDelete(r)}>Delete</button>
                        </>
                      )}
                      <button className="link-btn" onClick={() => handleDownloadPdf(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Download size={12} /> PDF
                      </button>
                    </td>
                  </tr>
                  {refundingId === r.id && (
                    <tr>
                      <td colSpan={7} style={{ padding: '10px', background: 'var(--panel-alt)' }}>
                        <div className="add-comm-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="text-[12.5px]" style={{ color: 'var(--paper-dim)', whiteSpace: 'nowrap' }}>
                            Refunding {inr(r.amount)} {isCredit ? 'to' : 'from'} {partyName(r[partyJoinKey])}
                          </span>
                          <input
                            type="date" className="date-input"
                            value={refundDate} onChange={(e) => setRefundDate(e.target.value)}
                            title="Date this refund actually happened"
                          />
                          <select className="select select--sm pay-account-select" value={refundAccountId} onChange={(e) => setRefundAccountId(e.target.value)}>
                            <option value="">{isCredit ? 'Paid out from...' : 'Received into...'}</option>
                            {bankAccounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.name} {a.account_mask ? `(${a.account_mask})` : ''}</option>
                            ))}
                          </select>
                          <button className="btn-primary" disabled={refundBusy} onClick={() => handleRecordRefund(r)}>
                            {refundBusy ? 'Saving…' : 'Save refund'}
                          </button>
                          <button className="link-btn" onClick={() => setRefundingId(null)}>Cancel</button>
                        </div>
                        {bankAccounts.length === 0 && (
                          <p className="login-footnote" style={{ marginTop: 6 }}>
                            No cash/bank accounts set up yet — add one on the Cash & Bank screen first.
                          </p>
                        )}
                        {refundError && <p className="text-[12.5px]" style={{ color: 'var(--brick)', marginTop: 6 }}>{refundError}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {filtered.length === 0 && <EmptyRow colSpan={7}>No {docLabel.toLowerCase()}s match these filters.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
