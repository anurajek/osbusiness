import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, getPeriodRange, isResolved } from '../lib/format'
import { PeriodSelector } from '../components/FilterControls'
import { SectionHeader, StatCard } from '../components/ui'

function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function monthLabel(d) { return d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }) }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000) }

function last12Months() {
  const now = new Date()
  return monthsInRange(new Date(now.getFullYear(), now.getMonth() - 11, 1), now)
}

function monthsInRange(from, to) {
  const months = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)
  // A custom range spanning years could otherwise generate an unreasonably
  // long chart - capped at 36 months (3 years), which comfortably covers
  // any realistic "how has this trended" question.
  let guard = 0
  while (cursor <= end && guard < 36) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    months.push({ key: monthKey(cursor), label: monthLabel(cursor), start: new Date(cursor), end: monthEnd })
    cursor.setMonth(cursor.getMonth() + 1)
    guard += 1
  }
  return months
}

export default function CollectionsTrendScreen() {
  const { firmId } = useFirm()
  const [invoices, setInvoices] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  useEffect(() => {
    if (!firmId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [{ data: invRows, error: invErr }, { data: txnRows, error: txnErr }] = await Promise.all([
        supabase.from('sales_invoices').select('id, issued_date, amount, paid_amount, is_cancelled, manual_status').eq('firm_id', firmId),
        supabase.from('bank_transactions').select('related_sales_invoice_id, txn_date').eq('firm_id', firmId).not('related_sales_invoice_id', 'is', null),
      ])
      if (cancelled) return
      if (invErr || txnErr) { setError((invErr || txnErr).message); setLoading(false); return }
      // Cancelled invoices are void - excluded from every calculation on
      // this screen, same as everywhere else isResolved()/is_cancelled is
      // used. Manually-resolved ones (Paid/Invoiced/Completed) are kept
      // here, deliberately, unlike Receivables' pending total - the trend
      // below is about invoices genuinely *issued* each month, a
      // historical fact regardless of how they were later resolved.
      setInvoices((invRows ?? []).filter((i) => !i.is_cancelled))
      setTransactions(txnRows ?? [])
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [firmId])

  const range = getPeriodRange(period, customFrom, customTo)
  const months = useMemo(() => (range ? monthsInRange(range.from, range.to) : last12Months()), [range])

  // The most recent bank transaction linked to each invoice, used as a
  // proxy for "the date it was actually paid." Only invoices that went
  // through Record Payment have this - one paid at creation/import time
  // (see InvoiceListScreen.jsx's "already paid" note) has no transaction
  // to point to, so it can't contribute a real days-to-collect number.
  // That's a real gap in the underlying data, not a bug - the trend below
  // says plainly, per month, how many paid invoices it could and couldn't
  // account for.
  const paidDateByInvoice = useMemo(() => {
    const map = new Map()
    for (const t of transactions) {
      const existing = map.get(t.related_sales_invoice_id)
      if (!existing || t.txn_date > existing) map.set(t.related_sales_invoice_id, t.txn_date)
    }
    return map
  }, [transactions])

  const trend = useMemo(() => months.map((m) => {
    const cohort = invoices.filter((inv) => {
      const d = new Date(inv.issued_date)
      return d >= m.start && d <= m.end
    })
    const totalInvoiced = cohort.reduce((s, i) => s + Number(i.amount), 0)
    const totalCollected = cohort.reduce((s, i) => s + Math.min(Number(i.paid_amount || 0), Number(i.amount)), 0)
    const collectionRate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : null

    const fullyPaid = cohort.filter((i) => Number(i.amount) - Number(i.paid_amount || 0) <= 0)
    const withKnownDate = fullyPaid.filter((i) => paidDateByInvoice.has(i.id))
    const avgDays = withKnownDate.length > 0
      ? Math.round(withKnownDate.reduce((s, i) => s + daysBetween(i.issued_date, paidDateByInvoice.get(i.id)), 0) / withKnownDate.length)
      : null

    return {
      label: m.label, key: m.key, invoiceCount: cohort.length,
      collectionRate, avgDays,
      fullyPaidCount: fullyPaid.length, knownDateCount: withKnownDate.length,
    }
  }), [months, invoices, paidDateByInvoice])

  // Standard textbook DSO - a balance-sheet snapshot, always "as of right
  // now" regardless of the period selected above (unlike the cohort trend,
  // this one genuinely can't be computed for a past date without
  // historical AR balances this app doesn't have). Also excludes anything
  // manually resolved (Paid/Invoiced/Completed), for the same
  // double-counting reason as Receivables' "still pending" figure.
  const dso = useMemo(() => {
    const now = new Date()
    const start90 = new Date(now); start90.setDate(start90.getDate() - 90)
    const salesLast90 = invoices.filter((i) => new Date(i.issued_date) >= start90).reduce((s, i) => s + Number(i.amount), 0)
    const totalAR = invoices.filter((i) => !isResolved(i)).reduce((s, i) => s + Math.max(0, Number(i.amount) - Number(i.paid_amount || 0)), 0)
    return {
      value: salesLast90 > 0 ? Math.round((totalAR / salesLast90) * 90 * 10) / 10 : null,
      totalAR, salesLast90,
    }
  }, [invoices])

  const overallAvgDays = useMemo(() => {
    const withDates = trend.filter((t) => t.avgDays != null)
    if (withDates.length === 0) return null
    return Math.round(withDates.reduce((s, t) => s + t.avgDays, 0) / withDates.length)
  }, [trend])

  const totalKnown = trend.reduce((s, t) => s + t.knownDateCount, 0)
  const totalFullyPaid = trend.reduce((s, t) => s + t.fullyPaidCount, 0)

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title="DSO & Collection Trends" note="how fast you're actually getting paid, and whether it's improving" />

      <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo} />
      <p className="login-footnote" style={{ marginTop: -6 }}>
        This period controls which months the trend charts below cover. DSO (right) is always as of today — a
        balance-sheet snapshot can't be shown "as of" a past period, for the same reason explained below.
      </p>

      <div className="grid-3">
        <StatCard label="DSO (trailing 90 days)" value={dso.value != null ? `${dso.value} days` : '—'} sub="Outstanding AR ÷ sales in last 90 days × 90" />
        <StatCard label={`Avg days to collect (${months.length}-month average)`} value={overallAvgDays != null ? `${overallAvgDays} days` : '—'} accent sub={`based on ${totalKnown} of ${totalFullyPaid} paid invoices with a recorded payment date`} />
        <StatCard label="Total outstanding AR" value={inr(dso.totalAR)} sub="every unpaid invoice, any age" />
      </div>

      <div className="card" style={{ marginTop: 4 }}>
        <p className="login-footnote" style={{ margin: 0, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--paper)' }}>What's below isn't textbook DSO for past months</strong> — DSO
          is a balance-sheet snapshot (today's outstanding AR against recent sales), and this app doesn't have
          historical daily AR balances to reconstruct it retroactively. What it shows instead is a real, honest
          alternative computed from data that actually exists: for invoices <em>issued</em> in each month, how long
          they actually took to get paid, and what fraction has been collected so far. Only Sales Invoices count
          toward this — Proforma Invoices aren't recognized revenue, so mixing them in would misstate the numbers.
          Cancelled invoices are excluded entirely.
        </p>
      </div>

      <div className="card chart-card">
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2>Avg days to collect, by month issued</h2>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--paper-dim)', fontSize: 11 }} axisLine={{ stroke: 'var(--rule)' }} tickLine={false} />
            <YAxis tick={{ fill: 'var(--paper-dim)', fontSize: 11 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}d`} />
            <Tooltip
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--rule)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--paper)' }}
              formatter={(value, name, props) => [
                value != null ? `${value} days (${props.payload.knownDateCount}/${props.payload.fullyPaidCount} invoices)` : 'No paid invoices with a known date yet',
                'Avg days to collect',
              ]}
            />
            <Line type="monotone" dataKey="avgDays" stroke="var(--brass)" strokeWidth={2} dot={{ r: 3, fill: 'var(--brass)' }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card chart-card">
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2>Collection rate, by month issued</h2>
        </div>
        <p className="login-footnote" style={{ marginTop: -6, marginBottom: 10 }}>
          % of that month's invoiced amount collected so far — the most recent month or two will naturally look
          low simply because not enough time has passed yet, not because collection got worse.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--paper-dim)', fontSize: 11 }} axisLine={{ stroke: 'var(--rule)' }} tickLine={false} />
            <YAxis tick={{ fill: 'var(--paper-dim)', fontSize: 11 }} axisLine={false} tickLine={false} width={40} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--rule)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--paper)' }}
              formatter={(value, name, props) => [value != null ? `${value}% (${props.payload.invoiceCount} invoices)` : 'No invoices issued this month', 'Collection rate']}
            />
            <Line type="monotone" dataKey="collectionRate" stroke="var(--teal)" strokeWidth={2} dot={{ r: 3, fill: 'var(--teal)' }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}
