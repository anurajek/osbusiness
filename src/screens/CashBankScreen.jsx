import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, toISODate, computeStatus, statusForStorage } from '../lib/format'
import { PeriodSelector, FilterBar, SORT_OPTIONS_DATE_AMOUNT, sortRows } from '../components/FilterControls'
import { SectionHeader, Stamp, EmptyRow, SortableTh } from '../components/ui'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf } from '../lib/pdf'
import { downloadListDocx } from '../lib/exportDocx'

export default function CashBankScreen() {
  const { firmId, firm } = useFirm()

  const [accounts, setAccounts] = useState([])
  const [txns, setTxns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [accountFilter, setAccountFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [reconFilter, setReconFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')
  const [search, setSearch] = useState('')

  const [showAddAccount, setShowAddAccount] = useState(false)
  const [editingAccountId, setEditingAccountId] = useState(null)
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountMask, setNewAccountMask] = useState('')
  const [newAccountBalance, setNewAccountBalance] = useState('0')
  const [addingAccount, setAddingAccount] = useState(false)
  const [addAccountError, setAddAccountError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [{ data: accRows, error: accErr }, { data: txnRows, error: txnErr }] = await Promise.all([
      supabase.from('bank_accounts').select('id, name, account_mask, balance').eq('firm_id', firmId).order('name'),
      supabase.from('bank_transactions').select('id, bank_account_id, txn_date, description, amount, reconciled, related_sales_invoice_id, related_purchase_bill_id, related_credit_note_id, related_debit_note_id').eq('firm_id', firmId).order('txn_date', { ascending: false }),
    ])
    if (accErr || txnErr) {
      setError((accErr || txnErr).message)
      setLoading(false)
      return
    }
    setAccounts(accRows ?? [])
    setTxns(txnRows ?? [])
    setLoading(false)
  }, [firmId])

  useEffect(() => { load() }, [load])

  const accountName = (id) => accounts.find((a) => a.id === id)?.name || '—'
  const range = getPeriodRange(period, customFrom, customTo)

  const filtered = useMemo(() => {
    let list = txns
    if (range) list = list.filter((t) => { const d = new Date(t.txn_date); return d >= range.from && d <= range.to })
    if (accountFilter !== 'all') list = list.filter((t) => t.bank_account_id === accountFilter)
    if (typeFilter !== 'all') list = list.filter((t) => (typeFilter === 'credit' ? t.amount > 0 : t.amount < 0))
    if (reconFilter !== 'all') list = list.filter((t) => (reconFilter === 'reconciled' ? t.reconciled : !t.reconciled))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((t) => t.description?.toLowerCase().includes(q) || accountName(t.bank_account_id).toLowerCase().includes(q))
    }
    return sortRows(list, sortBy, 'txn_date')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, range, accountFilter, typeFilter, reconFilter, search, sortBy, accounts])

  const resetAccountForm = () => {
    setEditingAccountId(null)
    setNewAccountName(''); setNewAccountMask(''); setNewAccountBalance('0')
  }

  const openCreateAccountForm = () => {
    resetAccountForm()
    setShowAddAccount(true)
  }

  const openEditAccountForm = (a) => {
    setEditingAccountId(a.id)
    setNewAccountName(a.name || '')
    setNewAccountMask(a.account_mask || '')
    setNewAccountBalance(String(a.balance ?? '0'))
    setShowAddAccount(true)
  }

  const handleSaveAccount = async (e) => {
    e.preventDefault()
    setAddAccountError(null)
    if (!newAccountName.trim()) { setAddAccountError('Enter a name (e.g. "Cash in hand" or "HDFC Current A/c").'); return }
    const balanceNum = parseFloat(newAccountBalance) || 0

    const payload = {
      name: newAccountName.trim(),
      account_mask: newAccountMask.trim() || null,
      balance: balanceNum,
    }

    setAddingAccount(true)
    const { error: err } = editingAccountId
      ? await supabase.from('bank_accounts').update(payload).eq('id', editingAccountId)
      : await supabase.from('bank_accounts').insert({ firm_id: firmId, ...payload })
    setAddingAccount(false)
    if (err) { setAddAccountError(err.message); return }
    resetAccountForm()
    setShowAddAccount(false)
    load()
  }

  // Deleting a transaction has to reverse everything it did, not just
  // remove the row - otherwise the account balance and the linked
  // invoice/bill/note would be left showing something that never actually
  // happened. subtracting txn.amount reverses it regardless of sign
  // (a credit reverses by subtracting a positive, a debit by subtracting
  // a negative, i.e. adding it back).
  const handleDeleteTransaction = async (txn) => {
    const linkedInvoice = txn.related_sales_invoice_id || txn.related_purchase_bill_id
    const linkedNote = txn.related_credit_note_id || txn.related_debit_note_id
    const warning = linkedInvoice
      ? ` This will also reduce the "already paid" amount back down on the ${txn.related_sales_invoice_id ? 'invoice' : 'bill'} it was recorded against.`
      : linkedNote
        ? ` This will also mark the ${txn.related_credit_note_id ? 'credit' : 'debit'} note it was recorded against as "Open" again.`
        : ''
    if (!window.confirm(`Delete this transaction (${inr(Math.abs(txn.amount))} on ${accountName(txn.bank_account_id)})?${warning}`)) return

    setDeletingId(txn.id)

    const account = accounts.find((a) => a.id === txn.bank_account_id)
    if (account) {
      const { error: acctErr } = await supabase
        .from('bank_accounts')
        .update({ balance: Number(account.balance) - txn.amount })
        .eq('id', txn.bank_account_id)
      if (acctErr) { setDeletingId(null); alert(`Couldn't reverse the account balance: ${acctErr.message}`); return }
    }

    if (linkedInvoice) {
      const table = txn.related_sales_invoice_id ? 'sales_invoices' : 'purchase_bills'
      const isSales = !!txn.related_sales_invoice_id
      const { data: doc } = await supabase.from(table).select('amount, paid_amount, due_date').eq('id', linkedInvoice).single()
      if (doc) {
        const newPaid = Math.max(0, Number(doc.paid_amount || 0) - Math.abs(txn.amount))
        const computed = computeStatus({ amount: doc.amount, paid_amount: newPaid, due_date: doc.due_date }, isSales ? 'Sent' : 'Approved')
        await supabase.from(table).update({ paid_amount: newPaid, status: statusForStorage(computed, isSales) }).eq('id', linkedInvoice)
      }
    }

    if (linkedNote) {
      const table = txn.related_credit_note_id ? 'credit_notes' : 'debit_notes'
      await supabase.from(table).update({ status: 'open', refunded_via_account_id: null, refunded_date: null }).eq('id', linkedNote)
    }

    const { error: delErr } = await supabase.from('bank_transactions').delete().eq('id', txn.id)
    setDeletingId(null)
    if (delErr) { alert(`Couldn't delete the transaction: ${delErr.message}`); return }

    await supabase.from('activity_log').insert({
      firm_id: firmId,
      description: `Deleted a ${inr(Math.abs(txn.amount))} transaction on ${accountName(txn.bank_account_id)}${linkedInvoice || linkedNote ? ' and reversed the linked record' : ''}`,
    })

    load()
  }

  const handleExportCsv = () => {
    downloadCsv(
      'cash-bank-transactions',
      ['Date', 'Account', 'Description', 'Amount', 'Type', 'Status'],
      filtered.map((t) => [
        toISODate(new Date(t.txn_date)),
        accountName(t.bank_account_id),
        t.description,
        Math.abs(t.amount).toFixed(2),
        t.amount > 0 ? 'Received' : 'Paid',
        t.reconciled ? 'Reconciled' : 'Pending',
      ])
    )
  }

  const handleExportPdf = () => {
    downloadListPdf({
      title: 'Cash & Bank Transactions',
      firm,
      filename: 'cash-bank-transactions',
      columns: [
        { label: 'Date' }, { label: 'Account' }, { label: 'Description' },
        { label: 'Amount', align: 'right' }, { label: 'Type' }, { label: 'Status' },
      ],
      rows: filtered.map((t) => [
        toISODate(new Date(t.txn_date)),
        accountName(t.bank_account_id),
        t.description,
        inr(Math.abs(t.amount)),
        t.amount > 0 ? 'Received' : 'Paid',
        t.reconciled ? 'Reconciled' : 'Pending',
      ]),
    })
  }

  const handleExportWord = () => {
    downloadListDocx({
      title: 'Cash & Bank Transactions',
      firm,
      filename: 'cash-bank-transactions',
      columns: [
        { label: 'Date' }, { label: 'Account' }, { label: 'Description' },
        { label: 'Amount', align: 'right' }, { label: 'Type' }, { label: 'Status' },
      ],
      rows: filtered.map((t) => [
        toISODate(new Date(t.txn_date)),
        accountName(t.bank_account_id),
        t.description,
        inr(Math.abs(t.amount)),
        t.amount > 0 ? 'Received' : 'Paid',
        t.reconciled ? 'Reconciled' : 'Pending',
      ]),
    })
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title="Cash & Bank" note="daily reconciliation" />

      <div className="card">
        <div className="section-header" style={{ marginBottom: showAddAccount ? 12 : 8 }}>
          <h2>Accounts</h2>
          <button
            className="link-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => (showAddAccount && !editingAccountId ? setShowAddAccount(false) : openCreateAccountForm())}
          >
            <Plus size={14} /> New account
          </button>
        </div>

        {showAddAccount && (
          <form onSubmit={handleSaveAccount} className="add-comm-form" style={{ marginBottom: 16 }}>
            <div className="drawer__label" style={{ marginBottom: -4 }}>
              {editingAccountId ? 'Editing account' : 'New account'}
            </div>
            <div className="add-comm-row">
              <input className="text-input" placeholder='Name (e.g. "Cash in hand", "HDFC Current A/c")' value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} />
              <input className="text-input" placeholder="Account mask (optional, e.g. ****4521)" value={newAccountMask} onChange={(e) => setNewAccountMask(e.target.value)} />
              <input type="number" step="0.01" className="text-input" placeholder="Balance (₹)" value={newAccountBalance} onChange={(e) => setNewAccountBalance(e.target.value)} />
            </div>
            {editingAccountId && (
              <p className="login-footnote" style={{ margin: 0 }}>
                Editing the balance here overrides it directly — it won't create a transaction record.
                Use "Record payment" on an invoice/bill, or add a transaction, for anything that should show up in the ledger below.
              </p>
            )}
            {addAccountError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{addAccountError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" disabled={addingAccount}>
                {addingAccount ? 'Saving…' : editingAccountId ? 'Save changes' : 'Add account'}
              </button>
              <button type="button" className="link-btn" onClick={() => { resetAccountForm(); setShowAddAccount(false) }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="grid-3">
          {accounts.map((a) => (
            <div key={a.id} className="card stat-card" style={{ border: 'none', background: 'var(--panel-alt)' }}>
              <div className="stat-card__top">
                <div className="stat-card__label">{a.name} {a.account_mask}</div>
                <button className="link-btn" style={{ padding: 0 }} onClick={() => openEditAccountForm(a)}>Edit</button>
              </div>
              <div className="stat-card__value">{inr(a.balance)}</div>
            </div>
          ))}
          {accounts.length === 0 && !showAddAccount && (
            <p className="login-footnote">No accounts set up yet — add "Cash in hand" or your bank account above to get started.</p>
          )}
        </div>
      </div>

      <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search description or account...' }}
        filters={[
          {
            label: 'Account', value: accountFilter, onChange: setAccountFilter,
            options: [{ value: 'all', label: 'All' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))],
          },
          {
            label: 'Type', value: typeFilter, onChange: setTypeFilter,
            options: [{ value: 'all', label: 'All' }, { value: 'credit', label: 'Credit' }, { value: 'debit', label: 'Debit' }],
          },
          {
            label: 'Status', value: reconFilter, onChange: setReconFilter,
            options: [{ value: 'all', label: 'All' }, { value: 'reconciled', label: 'Reconciled' }, { value: 'pending', label: 'Pending' }],
          },
        ]}
        sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS_DATE_AMOUNT }}
        exportOptions={{ onExcel: handleExportCsv, onPdf: handleExportPdf, onWord: handleExportWord, disabled: filtered.length === 0 }}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>Transactions</h2>
          <span className="section-header__note">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <SortableTh label="Date" ascValue="date-asc" descValue="date-desc" sortBy={sortBy} onSort={setSortBy} />
              <th>Account</th>
              <th>Description</th>
              <SortableTh label="Amount" ascValue="amount-asc" descValue="amount-desc" sortBy={sortBy} onSort={setSortBy} className="num" />
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="ledger-row">
                <td className="mono">{toISODate(new Date(t.txn_date))}</td>
                <td>{accountName(t.bank_account_id)}</td>
                <td>{t.description}</td>
                <td className={`num mono ${t.amount > 0 ? 'amt-pos' : 'amt-neg'}`}>
                  {t.amount > 0 ? '+' : '−'}{inr(t.amount)}
                </td>
                <td><Stamp ok={t.reconciled} /></td>
                <td>
                  <button
                    className="link-btn"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--brick)' }}
                    disabled={deletingId === t.id}
                    onClick={() => handleDeleteTransaction(t)}
                  >
                    <Trash2 size={12} /> {deletingId === t.id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <EmptyRow colSpan={6}>No transactions match these filters.</EmptyRow>}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}
