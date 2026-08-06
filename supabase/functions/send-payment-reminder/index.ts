// @ts-nocheck - Deno-flavored imports/globals, not resolvable by a
// Node-based editor/linter; this file only runs on Supabase's Deno runtime.
//
// Manual, single-document reminder send - triggered by the "Send reminder
// now" button in the app. Runs as the calling user (their JWT is forwarded
// to Supabase), so the same RLS that protects every other table naturally
// stops anyone from sending a reminder for a document outside their own
// firm - no separate authorization check needed for that part.
//
// See send-payment-reminders-batch for the automatic/cron counterpart,
// which is a deliberately separate function since it runs with elevated
// privileges across every firm, not scoped to one logged-in user.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { daysSince, currentStage, reminderEmailContent } from '../_shared/reminderLogic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('INVITE_FROM_EMAIL') ?? 'Ledger OS <onboarding@resend.dev>'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { documentType, documentId } = await req.json()
    if (!documentType || !documentId || !['invoice', 'proforma_invoice'].includes(documentType)) {
      return json({ error: 'Missing or invalid documentType/documentId' }, 400)
    }
    if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY is not configured for this project' }, 500)

    // User-scoped client: every read below goes through this, so RLS is
    // what actually enforces "only your own firm's documents" - not
    // application code that could have a bug in it.
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)

    const table = documentType === 'invoice' ? 'sales_invoices' : 'proforma_invoices'
    const numberField = documentType === 'invoice' ? 'invoice_no' : 'pi_no'
    const docLabel = documentType === 'invoice' ? 'Invoice' : 'Proforma Invoice'

    const { data: doc, error: docErr } = await supabase.from(table)
      .select(`id, firm_id, customer_id, issued_date, amount, paid_amount, reminders_paused, ${numberField}`)
      .eq('id', documentId).single()
    if (docErr || !doc) return json({ error: "Document not found, or you don't have access to it." }, 404)
    if (doc.reminders_paused) return json({ error: 'Reminders are paused for this document - resume them first.' }, 400)

    const balance = Number(doc.amount) - Number(doc.paid_amount || 0)
    if (balance <= 0) return json({ error: 'This is already fully paid - nothing to remind about.' }, 400)

    const { data: firm } = await supabase.from('firms').select('name, reminder_grace_days').eq('id', doc.firm_id).single()
    const { data: customer } = await supabase.from('customers').select('name, email').eq('id', doc.customer_id).single()
    const { data: reminderEmails } = await supabase.from('customer_reminder_emails').select('email').eq('customer_id', doc.customer_id)

    const recipients = (reminderEmails ?? []).map((r) => r.email)
    if (recipients.length === 0 && customer?.email) recipients.push(customer.email)
    if (recipients.length === 0) {
      return json({ error: "No reminder email configured for this customer - add one under that customer's Reminder Emails first." }, 400)
    }

    const graceDays = firm?.reminder_grace_days ?? 7
    const dsi = daysSince(doc.issued_date, new Date())
    const stage = currentStage(dsi, graceDays)
    if (!stage) {
      return json({ error: `Too early to send a reminder - the first one opens up on day 3 after issue (this is day ${dsi}).` }, 400)
    }

    const { subject, html } = reminderEmailContent(stage, {
      customerName: customer?.name,
      docLabel,
      docNumber: doc[numberField],
      amountDue: `₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      daysSinceIssued: dsi,
      graceDays,
      firmName: firm?.name || 'us',
    })

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html }),
    })
    const resendData = await res.json()
    if (!res.ok) return json({ error: resendData }, res.status)

    const today = new Date().toISOString().slice(0, 10)
    await supabase.from(table).update({ last_reminder_stage: stage, last_reminder_sent_date: today }).eq('id', documentId)

    // The reminder log has no insert policy for regular users by design
    // (it's an audit trail, not something client code should be able to
    // backdate or fabricate) - the service role bypasses that deliberately,
    // only for this one controlled write.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    await admin.from('payment_reminders_log').insert({
      firm_id: doc.firm_id, document_type: documentType, document_id: documentId,
      stage, sent_to: recipients.join(', '), triggered_by: 'manual',
    })

    return json({ ok: true, stage, sentTo: recipients })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
