// @ts-nocheck - Deno-flavored imports/globals, not resolvable by a
// Node-based editor/linter; this file only runs on Supabase's Deno runtime.
//
// Automatic reminder run - meant to be invoked once a day by a Supabase
// Cron Job (Dashboard -> Integrations -> Cron, or Database -> Cron Jobs).
// Deliberately a separate function from send-payment-reminder: this one
// runs with the service role (bypasses RLS entirely) because a cron
// trigger has no logged-in user to scope it to - it has to look across
// every firm in one run, not just one document a specific person asked
// about. Only ever sends a stage on its exact scheduled day (see
// exactStageForDay in _shared/reminderLogic.ts) and checks what was
// already sent today before sending again, so re-running this (or a
// slightly-late cron trigger) can't double-send the same reminder.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { daysSince, exactStageForDay, reminderEmailContent } from '../_shared/reminderLogic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('INVITE_FROM_EMAIL') ?? 'FinoPilo Flow <onboarding@resend.dev>'

const corsHeaders = { 'Access-Control-Allow-Origin': '*' }

async function sendOne({ admin, table, numberField, docLabel, documentType, doc, firmsById, customersById, emailsByCustomer, today }) {
  const firm = firmsById.get(doc.firm_id)
  if (!firm) return { skipped: 'no-firm' }

  const graceDays = firm.reminder_grace_days ?? 7
  const dsi = daysSince(doc.issued_date, new Date())
  const stage = exactStageForDay(dsi, graceDays)
  if (!stage) return { skipped: 'not-scheduled-today' }
  if (doc.last_reminder_stage === stage && doc.last_reminder_sent_date === today) return { skipped: 'already-sent-today' }

  const customer = customersById.get(doc.customer_id)
  const recipients = emailsByCustomer.get(doc.customer_id) ?? []
  if (recipients.length === 0 && customer?.email) recipients.push(customer.email)
  if (recipients.length === 0) return { skipped: 'no-email' }

  const balance = Number(doc.amount) - Number(doc.paid_amount || 0)
  const { subject, html } = reminderEmailContent(stage, {
    customerName: customer?.name,
    docLabel,
    docNumber: doc[numberField],
    amountDue: `₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    daysSinceIssued: dsi,
    graceDays,
    firmName: firm.name || 'us',
  })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html }),
  })
  if (!res.ok) return { error: await res.text() }

  await admin.from(table).update({ last_reminder_stage: stage, last_reminder_sent_date: today }).eq('id', doc.id)
  await admin.from('payment_reminders_log').insert({
    firm_id: doc.firm_id, document_type: documentType, document_id: doc.id,
    stage, sent_to: recipients.join(', '), triggered_by: 'automatic',
  })
  return { sent: stage }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY is not configured' }), { status: 500, headers: corsHeaders })
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: invoices }, { data: pis }, { data: firms }] = await Promise.all([
    admin.from('sales_invoices')
      .select('id, firm_id, customer_id, invoice_no, issued_date, amount, paid_amount, last_reminder_stage, last_reminder_sent_date')
      .eq('reminders_paused', false),
    admin.from('proforma_invoices')
      .select('id, firm_id, customer_id, pi_no, issued_date, amount, paid_amount, last_reminder_stage, last_reminder_sent_date')
      .eq('reminders_paused', false),
    admin.from('firms').select('id, name, reminder_grace_days'),
  ])

  const pendingInvoices = (invoices ?? []).filter((d) => Number(d.amount) - Number(d.paid_amount || 0) > 0)
  const pendingPis = (pis ?? []).filter((d) => Number(d.amount) - Number(d.paid_amount || 0) > 0)
  const firmsById = new Map((firms ?? []).map((f) => [f.id, f]))

  const customerIds = [...new Set([...pendingInvoices, ...pendingPis].map((d) => d.customer_id))]
  const [{ data: customers }, { data: reminderEmailRows }] = await Promise.all([
    customerIds.length ? admin.from('customers').select('id, name, email').in('id', customerIds) : { data: [] },
    customerIds.length ? admin.from('customer_reminder_emails').select('customer_id, email').in('customer_id', customerIds) : { data: [] },
  ])
  const customersById = new Map((customers ?? []).map((c) => [c.id, c]))
  const emailsByCustomer = new Map()
  for (const row of reminderEmailRows ?? []) {
    if (!emailsByCustomer.has(row.customer_id)) emailsByCustomer.set(row.customer_id, [])
    emailsByCustomer.get(row.customer_id).push(row.email)
  }

  const results = { sent: 0, skipped: 0, errors: 0 }
  for (const doc of pendingInvoices) {
    const r = await sendOne({ admin, table: 'sales_invoices', numberField: 'invoice_no', docLabel: 'Invoice', documentType: 'invoice', doc, firmsById, customersById, emailsByCustomer, today })
    if (r.sent) results.sent++; else if (r.error) results.errors++; else results.skipped++
  }
  for (const doc of pendingPis) {
    const r = await sendOne({ admin, table: 'proforma_invoices', numberField: 'pi_no', docLabel: 'Proforma Invoice', documentType: 'proforma_invoice', doc, firmsById, customersById, emailsByCustomer, today })
    if (r.sent) results.sent++; else if (r.error) results.errors++; else results.skipped++
  }

  return new Response(JSON.stringify({ ok: true, checked: pendingInvoices.length + pendingPis.length, ...results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
