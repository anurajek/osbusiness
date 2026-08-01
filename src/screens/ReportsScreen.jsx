import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, toISODate, getFiscalYearRange } from '../lib/format'

const REPORTS = ['Trial Balance', 'Profit & Loss', 'Balance Sheet']

// A debit increases asset/expense accounts and decreases liability/equity/
// income accounts - the reverse is true for a credit. This is the one rule
// that turns raw debit/credit totals into a "normal balance" per account.
function netBalance(type, debit, credit) {
  return type === 'asset' || type === 'expense' ? debit - credit : credit - debit
}

function lastDayOfPrevMonth(today) {
  return new Date(today.getFullYear(), today.getMonth(), 0)
}

export default function ReportsScreen() {
  const { firmId } = useFirm()
  const [report, setReport] = useState('Trial Balance')

  // Range-based period (Profit & Loss) - reactive, no fetch/apply button:
  // picking a preset or typing a custom date immediately re-derives the
  // report from data that's already loaded, via the useMemo filters below.
  const [rangePreset, setRangePreset] = useState('This Fiscal Year')
  const [customFrom, setCustomFrom] = useState(toISODate(new Date()))
  const [customTo, setCustomTo] = useState(toISODate(new Date()))

  // As-of-date period (Trial Balance / Balance Sheet) - a snapshot date,
  // not a range, which is the correct accounting shape for both reports.
  const [asOfPreset, setAsOfPreset] = useState('Today')
  const [customAsOf, setCustomAsOf] = useState(toISODate(new Date()))

  const [accounts, setAccounts] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!firmId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const [accountsRes, linesRes] = await Promise.all([
        supabase.from('chart_of_accounts').select('id, code, name, type').eq('firm_id', firmId).order('code'),
        supabase
          .from('journal_entry_lines')
          .select('debit, credit, account_id, journal_entries!inner(firm_id, entry_date, status)')
          .eq('journal_entries.firm_id', firmId)
          .eq('journal_entries.status', 'posted'),
      ])
      if (cancelled) return
      if (accountsRes.error) { setError(accountsRes.error.message); setLoading(false); return }
      if (linesRes.error) { setError(linesRes.error.message); setLoading(false); return }
      setAccounts(accountsRes.data ?? [])
      setLines(linesRes.data ?? [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [firmId])

  const today = new Date()

  const asOfDate = useMemo(() => {
    if (asOfPreset === 'Custom') return customAsOf
    if (asOfPreset === 'End of Last Month') return toISODate(lastDayOfPrevMonth(today))
    if (asOfPreset === 'End of Previous FY') return toISODate(getFiscalYearRange(-1, today).end)
    return toISODate(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOfPreset, customAsOf])

  const range = useMemo(() => {
    if (rangePreset === 'All Time') return null
    if (rangePreset === 'Custom') return { start: new Date(customFrom), end: new Date(customTo) }
    if (rangePreset === 'Previous Fiscal Year') return getFiscalYearRange(-1, today)
    if (rangePreset === 'Last 12 Months') return { start: new Date(today.getFullYear(), today.getMonth() - 11, 1), end: today }
    return getFiscalYearRange(0, today) // 'This Fiscal Year'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset, customFrom, customTo])

  // Trial Balance / Balance Sheet: every posted line up to and including asOfDate.
  const linesAsOf = useMemo(
    () => lines.filter((l) => l.journal_entries.entry_date <= asOfDate),
    [lines, asOfDate]
  )
  // P&L: lines within the selected range, or everything if "All Time".
  const linesInRange = useMemo(() => {
    if (!range) return lines
    return lines.filter((l) => {
      const d = new Date(l.journal_entries.entry_date)
      return d >= range.start && d <= range.end
    })
  }, [lines, range])

  const totalsByAccount = (rows) => {
    const totals = {}
    for (const l of rows) {
      const t = totals[l.account_id] ?? { debit: 0, credit: 0 }
      t.debit += Number(l.debit) || 0
      t.credit += Number(l.credit) || 0
      totals[l.account_id] = t
    }
    return totals
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <div className="tabs">
        {REPORTS.map((r) => (
          <button key={r} className={`tab ${report === r ? 'tab--active' : ''}`} onClick={() => setReport(r)}>{r}</button>
        ))}
      </div>

      {report === 'Profit & Loss' ? (
        <RangePeriodBar preset={rangePreset} setPreset={setRangePreset} from={customFrom} to={customTo} setFrom={setCustomFrom} setTo={setCustomTo} />
      ) : (
        <AsOfPeriodBar preset={asOfPreset} setPreset={setAsOfPreset} date={customAsOf} setDate={setCustomAsOf} />
      )}

      {report === 'Trial Balance' && <TrialBalance accounts={accounts} totals={totalsByAccount(linesAsOf)} />}
      {report === 'Profit & Loss' && <ProfitAndLoss accounts={accounts} totals={totalsByAccount(linesInRange)} />}
      {report === 'Balance Sheet' && <BalanceSheet accounts={accounts} totals={totalsByAccount(linesAsOf)} />}
    </>
  )
}

const RANGE_PRESETS = ['This Fiscal Year', 'Previous Fiscal Year', 'Last 12 Months', 'All Time', 'Custom']
const AS_OF_PRESETS = ['Today', 'End of Last Month', 'End of Previous FY', 'Custom']

function RangePeriodBar({ preset, setPreset, from, to, setFrom, setTo }) {
  return (
    <div className="period-bar" style={{ marginBottom: 12 }}>
      {RANGE_PRESETS.map((p) => (
        <button key={p} className={`period-pill ${preset === p ? 'period-pill--active' : ''}`} onClick={() => setPreset(p)}>{p}</button>
      ))}
      {preset === 'Custom' && (
        <span className="period-custom">
          <input type="date" className="date-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="period-custom__to">to</span>
          <input type="date" className="date-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </span>
      )}
    </div>
  )
}

function AsOfPeriodBar({ preset, setPreset, date, setDate }) {
  return (
    <div className="period-bar" style={{ marginBottom: 12 }}>
      {AS_OF_PRESETS.map((p) => (
        <button key={p} className={`period-pill ${preset === p ? 'period-pill--active' : ''}`} onClick={() => setPreset(p)}>{p}</button>
      ))}
      {preset === 'Custom' && (
        <span className="period-custom">
          <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </span>
      )}
    </div>
  )
}

function TrialBalance({ accounts, totals }) {
  const rows = accounts
    .map((a) => ({ ...a, ...(totals[a.id] ?? { debit: 0, credit: 0 }) }))
    .filter((a) => a.debit > 0 || a.credit > 0)
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)

  return (
    <div className="card">
      <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr><th>Code</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="ledger-row">
                <td>{r.code}</td><td>{r.name}</td>
                <td className="num">{r.debit > 0 ? inr(r.debit) : ''}</td>
                <td className="num">{r.credit > 0 ? inr(r.credit) : ''}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="empty-state">No posted entries yet.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="ledger-row" style={{ fontWeight: 600 }}>
                <td colSpan={2}>Total</td>
                <td className="num">{inr(totalDebit)}</td>
                <td className="num">{inr(totalCredit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length > 0 && Math.round(totalDebit * 100) !== Math.round(totalCredit * 100) && (
        <p className="text-[12.5px]" style={{ color: 'var(--brick)', marginTop: 8 }}>
          This doesn't balance — that shouldn't be possible from posted entries alone and is worth investigating.
        </p>
      )}
    </div>
  )
}

function ProfitAndLoss({ accounts, totals }) {
  const withAmount = (type) => accounts
    .filter((a) => a.type === type)
    .map((a) => {
      const t = totals[a.id] ?? { debit: 0, credit: 0 }
      return { ...a, amount: netBalance(type, t.debit, t.credit) }
    })
  const income = withAmount('income')
  const expense = withAmount('expense')
  const totalIncome = income.reduce((s, a) => s + a.amount, 0)
  const totalExpense = expense.reduce((s, a) => s + a.amount, 0)
  const net = totalIncome - totalExpense

  return (
    <div className="card">
      <div className="grid-2">
        <Section title="Income" rows={income} total={totalIncome} />
        <Section title="Expenses" rows={expense} total={totalExpense} />
      </div>
      <div className="section-header" style={{ marginTop: 12, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
        <h2>Net {net >= 0 ? 'Profit' : 'Loss'}</h2>
        <span style={{ fontWeight: 600, color: net >= 0 ? 'var(--teal)' : 'var(--brick)' }}>{inr(net)}</span>
      </div>
    </div>
  )
}

function BalanceSheet({ accounts, totals }) {
  const withAmount = (type) => accounts
    .filter((a) => a.type === type)
    .map((a) => {
      const t = totals[a.id] ?? { debit: 0, credit: 0 }
      return { ...a, amount: netBalance(type, t.debit, t.credit) }
    })
  const assets = withAmount('asset')
  const liabilities = withAmount('liability')
  const income = withAmount('income')
  const expense = withAmount('expense')

  // A Balance Sheet only balances if income/expense accounts (which are
  // "temporary" - they normally get zeroed out into equity at period-end
  // via closing entries) are reflected in Equity somewhere. This module
  // doesn't have a closing-entries step yet, so an interim balance sheet
  // rolls the net of everything posted so far into a computed "Current
  // Earnings" line, the same way QuickBooks/Tally show an interim balance
  // sheet before the books are formally closed for the year.
  const currentEarnings = income.reduce((s, a) => s + a.amount, 0) - expense.reduce((s, a) => s + a.amount, 0)
  const equity = [
    ...withAmount('equity'),
    { id: '__current_earnings', code: '', name: 'Current Earnings (unclosed)', amount: currentEarnings },
  ]

  const totalAssets = assets.reduce((s, a) => s + a.amount, 0)
  const totalLiabilities = liabilities.reduce((s, a) => s + a.amount, 0)
  const totalEquity = equity.reduce((s, a) => s + a.amount, 0)
  const balances = Math.round(totalAssets * 100) === Math.round((totalLiabilities + totalEquity) * 100)

  return (
    <div className="card">
      <div className="grid-2">
        <Section title="Assets" rows={assets} total={totalAssets} />
        <div>
          <Section title="Liabilities" rows={liabilities} total={totalLiabilities} />
          <Section title="Equity" rows={equity} total={totalEquity} />
        </div>
      </div>
      <div className="section-header" style={{ marginTop: 12, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
        <h2>Assets vs. Liabilities + Equity</h2>
        <span style={{ fontWeight: 600, color: balances ? 'var(--teal)' : 'var(--brick)' }}>
          {inr(totalAssets)} {balances ? '=' : '≠'} {inr(totalLiabilities + totalEquity)}
        </span>
      </div>
    </div>
  )
}

function Section({ title, rows, total }) {
  const shown = rows.filter((r) => r.amount !== 0)
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="section-header" style={{ marginBottom: 6 }}><h2>{title}</h2></div>
      <div className="table-scroll">
        <table className="ledger-table">
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="ledger-row">
                <td>{r.code ? `${r.code} - ${r.name}` : r.name}</td>
                <td className="num">{inr(r.amount)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={2} className="empty-state">Nothing here yet.</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="ledger-row" style={{ fontWeight: 600 }}>
                <td>Total {title}</td>
                <td className="num">{inr(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
