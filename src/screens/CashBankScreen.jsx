import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, toISODate } from '../lib/format'
import { PeriodSelector, FilterBar, SORT_OPTIONS_DATE_AMOUNT, sortRows } from '../components/FilterControls'
import { SectionHeader, Stamp, EmptyRow } from '../components/ui'

export default function CashBankScreen() {
  const { firmId } = useFirm()

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
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountMask, setNewAccountMask] = useState('')
  const [newAccountBalance, setNewAccountBalance] = useState('0')
  const [addingAccount, setAddingAccount] = useState(false)
  const [addAccountError, setAddAccountError] = useState(null)

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [{ data: accRows, error: accErr }, { data: txnRows, error: txnErr }] = await Promise.all([
      supabase.from('bank_accounts').select('id, name, account_mask, balance').eq('firm_id', firmId).order('name'),
      supabase.from('bank_transactions').select('id, bank_account_id, txn_date, description, amount, reconciled').eq('firm_id', firmId).order('txn_date', { ascending: false }),
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

  const handleAddAccount = async (e) => {
    e.preventDefault()
    setAddAccountError(null)
    if (!newAccountName.trim()) { setAddAccountError('Enter a name (e.g. "Cash in hand" or "HDFC Current A/c").'); return }
    const openingBalance = parseFloat(newAccountBalance) || 0

    setAddingAccount(true)
    const { error: err } = await supabase.from('bank_accounts').insert({
      firm_id: firmId,
      name: newAccountName.trim(),
      account_mask: newAccountMask.trim() || null,
      balance: openingBalance,
    })
    setAddingAccount(false)
    if (err) { setAddAccountError(err.message); return }
    setNewAccountName(''); setNewAccountMask(''); setNewAccountBalance('0')
    setShowAddAccount(false)
    load()
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title="Cash & Bank" note="daily reconciliation" />

      <div className="card">
        <div className="section-header" style={{ marginBottom: showAddAccount ? 12 : 8 }}>
          <h2>Accounts</h2>
          <button className="link-btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setShowAddAccount((v) => !v)}>
            <Plus size={14} /> New account
          </button>
        </div>

        {showAddAccount && (
          <form onSubmit={handleAddAccount} className="add-comm-form" style={{ marginBottom: 16 }}>
            <div className="add-comm-row">
              <input className="text-input" placeholder='Name (e.g. "Cash in hand", "HDFC Current A/c")' value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} />
              <input className="text-input" placeholder="Account mask (optional, e.g. ****4521)" value={newAccountMask} onChange={(e) => setNewAccountMask(e.target.value)} />
              <input type="number" step="0.01" className="text-input" placeholder="Opening balance (₹)" value={newAccountBalance} onChange={(e) => setNewAccountBalance(e.target.value)} />
            </div>
            {addAccountError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{addAccountError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" disabled={addingAccount}>{addingAccount ? 'Adding…' : 'Add account'}</button>
              <button type="button" className="link-btn" onClick={() => setShowAddAccount(false)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="grid-3">
          {accounts.map((a) => (
            <div key={a.id} className="card stat-card" style={{ border: 'none', background: 'var(--panel-alt)' }}>
              <div className="stat-card__label">{a.name} {a.account_mask}</div>
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
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>Transactions</h2>
          <span className="section-header__note">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        <table className="ledger-table">
          <thead><tr><th>Date</th><th>Account</th><th>Description</th><th className="num">Amount</th><th>Status</th></tr></thead>
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
              </tr>
            ))}
            {filtered.length === 0 && <EmptyRow colSpan={5}>No transactions match these filters.</EmptyRow>}
          </tbody>
        </table>
      </div>
    </>
  )
}
