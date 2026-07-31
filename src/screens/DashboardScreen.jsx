import { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, computeStatus, toISODate } from '../lib/format'
import { SectionHeader, StatCard, CardLinkHeader, AgingBar } from '../components/ui'

const AGE_BUCKETS = ['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days']
const CASH_FLOW_PERIODS = ['This Fiscal Year', 'Previous Fiscal Year', 'Last 12 Months']

function bucketFor(daysOverdue) {
  if (daysOverdue <= 0) return 'Current'
  if (daysOverdue <= 30) return '1–30 days'
  if (daysOverdue <= 60) return '31–60 days'
  if (daysOverdue <= 90) return '61–90 days'
  return '90+ days'
}

function buildAgeing(openRows) {
  const totals = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0]))
  const today = new Date()
  for (const r of openRows) {
    const due = r.due_date ? new Date(r.due_date) : new Date(r.issued_date)
    const daysOverdue = Math.floor((today - due) / 86400000)
    totals[bucketFor(daysOverdue)] += (r.amount - r.paid_amount)
  }
  return AGE_BUCKETS.map((bucket) => ({ bucket, amount: totals[bucket] }))
}

function buildForecast(openInvoices, openBills, startingBalance) {
  const weeks = []
  const today = new Date()
  let running = startingBalance
  for (let w = 0; w < 6; w++) {
    const weekStart = new Date(today); weekStart.setDate(today.getDate() + w * 7)
    const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + (w + 1) * 7)
    const inflow = openInvoices
      .filter((i) => { const d = new Date(i.due_date || i.issued_date); return d >= weekStart && d < weekEnd })
      .reduce((s, i) => s + (i.amount - i.paid_amount), 0)
    const outflow = openBills
      .filter((b) => { const d = new Date(b.due_date || b.issued_date); return d >= weekStart && d < weekEnd })
      .reduce((s, b) => s + (b.amount - b.paid_amount), 0)
    running = running + inflow - outflow
    weeks.push({ week: `Wk ${w + 1}`, inflow, outflow, closing: running })
  }
  return weeks
}

// India's fiscal year runs April -> March. offset 0 = current FY, -1 = previous FY.
function getFiscalYearRange(offset, today) {
  const fyStartCalendarYear = (today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1) + offset
  return {
    start: new Date(fyStartCalendarYear, 3, 1),
    end: new Date(fyStartCalendarYear + 1, 2, 31, 23, 59, 59, 999),
  }
}

function buildMonthBuckets(start, end) {
  const buckets = []
  let cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) {
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999)
    buckets.push({
      label: cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      start: new Date(cur),
      end: monthEnd,
    })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return buckets
}

// Reconstructs a month-by-month cash flow trend purely from the transaction
// log plus today's known total balance - working backward from "now" so the
// historical balance line stays correct even though we only store the
// current balance on each account, not a balance-as-of-every-day snapshot.
function buildCashFlowSeries(bankTxns, period, currentTotalBalance) {
  const today = new Date()
  const range = period === 'Last 12 Months'
    ? { start: new Date(today.getFullYear(), today.getMonth() - 11, 1), end: today }
    : getFiscalYearRange(period === 'Previous Fiscal Year' ? -1 : 0, today)

  const buckets = buildMonthBuckets(range.start, range.end)

  const series = buckets.map(({ label, start, end }) => {
    const inMonth = bankTxns.filter((t) => { const d = new Date(t.txn_date); return d >= start && d <= end })
    const incoming = inMonth.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
    const outgoing = inMonth.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
    const sumAfter = bankTxns.filter((t) => new Date(t.txn_date) > end).reduce((s, t) => s + t.amount, 0)
    const balance = currentTotalBalance - sumAfter
    return { label, incoming, outgoing, balance }
  })

  const totalIncoming = series.reduce((s, m) => s + m.incoming, 0)
  const totalOutgoing = series.reduce((s, m) => s + m.outgoing, 0)
  const asOfDate = range.end > today ? today : range.end

  return { series, totalIncoming, totalOutgoing, finalBalance: currentTotalBalance, asOfDate }
}

export default function DashboardScreen({ onNavigate }) {
  const { firmId, firm } = useFirm()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cashFlowPeriod, setCashFlowPeriod] = useState('Last 12 Months')
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false)

  useEffect(() => {
    if (!firmId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const [
        { data: accounts, error: accErr },
        { data: invoices, error: invErr },
        { data: bills, error: billErr },
        { data: activity, error: actErr },
        { data: bankTxns, error: txnErr },
      ] = await Promise.all([
        supabase.from('bank_accounts').select('id, balance').eq('firm_id', firmId),
        supabase.from('sales_invoices').select('id, due_date, issued_date, amount, paid_amount, status').eq('firm_id', firmId),
        supabase.from('purchase_bills').select('id, due_date, issued_date, amount, paid_amount, status').eq('firm_id', firmId),
        supabase.from('activity_log').select('id, description, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(6),
        supabase.from('bank_transactions').select('id, txn_date, amount').eq('firm_id', firmId),
      ])

      if (cancelled) return
      const err = accErr || invErr || billErr || actErr || txnErr
      if (err) { setError(err.message); setLoading(false); return }

      const openInvoices = (invoices ?? []).filter((i) => computeStatus(i, 'Sent') !== 'Paid')
      const openBills = (bills ?? []).filter((b) => computeStatus(b, 'Approved') !== 'Paid')
      const totalCash = (accounts ?? []).reduce((s, a) => s + a.balance, 0)
      const totalAR = openInvoices.reduce((s, i) => s + (i.amount - i.paid_amount), 0)
      const totalAP = openBills.reduce((s, b) => s + (b.amount - b.paid_amount), 0)

      setData({
        totalCash, totalAR, totalAP,
        accountCount: (accounts ?? []).length,
        arAgeing: buildAgeing(openInvoices),
        apAgeing: buildAgeing(openBills),
        forecast: buildForecast(openInvoices, openBills, totalCash),
        activity: activity ?? [],
        bankTxns: bankTxns ?? [],
      })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [firmId])

  const cashFlow = useMemo(() => {
    if (!data) return null
    return buildCashFlowSeries(data.bankTxns, cashFlowPeriod, data.totalCash)
  }, [data, cashFlowPeriod])

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>
  if (!data) return null

  const arMax = Math.max(1, ...data.arAgeing.map((r) => r.amount))
  const apMax = Math.max(1, ...data.apAgeing.map((r) => r.amount))

  return (
    <>
      <SectionHeader title="Overview" note={firm ? `${firm.name} · today` : 'today'} />
      <div className="grid-4">
        <StatCard label="Cash + bank" value={inr(data.totalCash)} sub={`${data.accountCount} account${data.accountCount !== 1 ? 's' : ''}`} accent onClick={() => onNavigate('cashbank')} />
        <StatCard label="Receivable (AR)" value={inr(data.totalAR)} sub="open invoices" onClick={() => onNavigate('arap', 'receivables')} />
        <StatCard label="Payable (AP)" value={inr(data.totalAP)} sub="open bills" onClick={() => onNavigate('arap', 'payables')} />
        <StatCard label="Net position" value={inr(data.totalCash + data.totalAR - data.totalAP)} sub="cash + AR − AP" />
      </div>

      <div className="card chart-card">
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2>Cash Flow</h2>
          <div style={{ position: 'relative' }}>
            <button
              className="period-pill period-pill--active"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setPeriodMenuOpen((v) => !v)}
            >
              {cashFlowPeriod} <ChevronDown size={14} />
            </button>
            {periodMenuOpen && (
              <div className="card" style={{ position: 'absolute', top: '110%', right: 0, zIndex: 30, minWidth: 190, padding: 6 }}>
                {CASH_FLOW_PERIODS.map((p) => (
                  <button
                    key={p}
                    className={`nav-item ${p === cashFlowPeriod ? 'nav-item--active' : ''}`}
                    onClick={() => { setCashFlowPeriod(p); setPeriodMenuOpen(false) }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={cashFlow.series} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="cashFlowFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brass)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--brass)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--paper-dim)', fontSize: 11 }} axisLine={{ stroke: 'var(--rule)' }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--paper-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `₹${Math.round(v / 100000)}L`} width={50} />
                <Tooltip
                  contentStyle={{ background: 'var(--panel)', border: '1px solid var(--rule)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--paper)' }}
                  formatter={(value) => [inr(value), 'Cash balance']}
                />
                <Area type="monotone" dataKey="balance" stroke="var(--brass)" strokeWidth={2} fill="url(#cashFlowFill)" dot={{ r: 3, fill: 'var(--brass)' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: 16, justifyContent: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--teal)', display: 'inline-block' }} />
                <span className="stat-card__label" style={{ margin: 0 }}>Incoming</span>
              </div>
              <div className="stat-card__value" style={{ fontSize: 16, color: 'var(--teal)' }}>+{inr(cashFlow.totalIncoming)}</div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--brick)', display: 'inline-block' }} />
                <span className="stat-card__label" style={{ margin: 0 }}>Outgoing</span>
              </div>
              <div className="stat-card__value" style={{ fontSize: 16, color: 'var(--brick)' }}>−{inr(cashFlow.totalOutgoing)}</div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--brass)', display: 'inline-block' }} />
                <span className="stat-card__label" style={{ margin: 0 }}>Cash as on {toISODate(cashFlow.asOfDate)}</span>
              </div>
              <div className="stat-card__value" style={{ fontSize: 16 }}>{inr(cashFlow.finalBalance)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card chart-card">
        <div className="section-header" style={{ marginBottom: 4 }}>
          <h2>6-week cashflow forecast</h2>
          <span className="section-header__note">inflow / outflow / projected closing balance</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data.forecast} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="week" tick={{ fill: 'var(--paper-dim)', fontSize: 12 }} axisLine={{ stroke: 'var(--rule)' }} tickLine={false} />
            <YAxis tick={{ fill: 'var(--paper-dim)', fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={54} />
            <Tooltip
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--rule)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--paper)' }}
              formatter={(value, name) => [inr(value), name === 'closing' ? 'Closing balance' : name === 'inflow' ? 'Inflow' : 'Outflow']}
            />
            <Bar dataKey="inflow" fill="var(--teal)" radius={[3, 3, 0, 0]} barSize={16} />
            <Bar dataKey="outflow" fill="var(--brick)" radius={[3, 3, 0, 0]} barSize={16} />
            <Line type="monotone" dataKey="closing" stroke="var(--brass)" strokeWidth={2} dot={{ r: 3, fill: 'var(--brass)' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid-2">
        <div className="card">
          <CardLinkHeader title="AR ageing" onClick={() => onNavigate('arap', 'receivables')} />
          <AgingBar rows={data.arAgeing} max={arMax} />
        </div>
        <div className="card">
          <CardLinkHeader title="AP ageing" onClick={() => onNavigate('arap', 'payables')} />
          <AgingBar rows={data.apAgeing} max={apMax} />
        </div>
      </div>

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}><h2>Recent activity</h2></div>
        {data.activity.length === 0 && <p className="empty-state">Nothing logged yet.</p>}
        <ul className="activity-list">
          {data.activity.map((a) => (
            <li key={a.id} className="activity-row">
              <span className="activity-dot" />
              <span>{a.description}</span>
              <span className="activity-when">{new Date(a.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
