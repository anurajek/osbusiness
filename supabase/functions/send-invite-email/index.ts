// Supabase Edge Function: send-invite-email
//
// Sends the actual invite notification email when an Owner invites a
// teammate from Users & Permissions. The firm_members row (created by the
// client just before this is called) is what actually grants access - this
// function is a courtesy notification on top of that, so a failure here is
// never allowed to look like the invite itself failed (see handleInvite in
// PermissionsScreen.jsx, which shows a fallback "tell them manually"
// message instead of an error banner if this call fails).
//
// One-time setup required before this works (see README.md → "Invite
// emails" for the full walkthrough):
//   1. Create a free Resend account (https://resend.com) and get an API key
//   2. In Supabase Dashboard → Edge Functions → Manage secrets, add:
//        RESEND_API_KEY = <your key>
//      Optionally also set:
//        INVITE_FROM_EMAIL = "FinoPilo Flow <you@yourdomain.com>"
//        (defaults to Resend's shared onboarding@resend.dev sender, which
//        works immediately but looks less official than your own domain)
//   3. Deploy this function from Supabase Dashboard → Edge Functions →
//      Create a new function → name it exactly "send-invite-email" → paste
//      this file's contents → Deploy. (No CLI needed - the dashboard editor
//      works fine for a function this size.)

// @ts-nocheck - Deno-flavored imports/globals, not resolvable by a
// Node-based editor/linter; this file only runs on Supabase's Deno runtime.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('INVITE_FROM_EMAIL') ?? 'FinoPilo Flow <onboarding@resend.dev>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://osbusiness.anuraj1996anu.workers.dev'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email, fullName, firmName, token } = await req.json()

    if (!email || !firmName || !token) {
      return new Response(JSON.stringify({ error: 'Missing email, firmName, or token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY is not configured for this project' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const joinUrl = `${APP_URL}/?invite=${token}`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: `You've been invited to ${firmName} on FinoPilo Flow`,
        html: `
          <div style="font-family: 'Times New Roman', Times, serif;">
          <p>Hi ${fullName || 'there'},</p>
          <p>You've been invited to join <strong>${firmName}</strong> on FinoPilo Flow.</p>
          <p>Click below to accept and create your account:</p>
          <p><a href="${joinUrl}">${joinUrl}</a></p>
          <p style="color:#888;font-size:13px">This link is unique to you - please don't forward it.</p>
          </div>
        `,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
