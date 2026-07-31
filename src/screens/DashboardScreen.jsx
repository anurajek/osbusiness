import { useEffect, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, computeStatus } from '../lib/format'
import { SectionHeader, StatCard, CardLinkHeader, AgingBar } from '../components/ui'

const AGE_BUCKETS = ['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days']

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

export default function DashboardScreen({ onNavigate }) {
  const { firmId, firm } = useFirm()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
      ] = await Promise.all([
        supabase.from('bank_accounts').select('id, balance').eq('firm_id', firmId),
        supabase.from('sales_invoices').select('id, due_date, issued_date, amount, paid_amount, status').eq('firm_id', firmId),
        supabase.from('purchase_bills').select('id, due_date, issued_date, amount, paid_amount, status').eq('firm_id', firmId),
        supabase.from('activity_log').select('id, description, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(6),
      ])

      if (cancelled) return
      const err = accErr || invErr || billErr || actErr
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
      })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [firmId])

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
