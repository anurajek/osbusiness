# Ledger OS

Multi-tenant accounting CRM — cashflow forecasting, sales, purchases, AR/AP, and cash & bank, built for firms managing multiple client books.

## Stack
- React + Vite
- Tailwind CSS v4
- Supabase (Postgres + Auth + Row Level Security)

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in your real Supabase URL + anon key
   (Supabase Dashboard → Settings → API)
3. Run `ledger_os_schema.sql` in Supabase's SQL Editor if you haven't already,
   then `migration_multitenant.sql` (enables self-service signup + invites)
4. Enable Email auth: Supabase → Authentication → Providers
5. `npm run dev`

## Onboarding a new firm (no SQL needed anymore)

Go to the app, click "New here? Create your firm" on the login screen, fill
in your name/firm/email/password. You're automatically the Owner.

## Inviting a teammate

Users & Permissions → "Invite a teammate" → enter their name, email, role.
Tell them (outside the app - no invite email is sent yet) to go create an
account or sign in using that exact email. The moment they do, they're
automatically linked to the firm with the role you set.

## Status

- [x] Self-service signup: create account + firm together, auto-Owner
- [x] Team invites: pending membership by email, auto-linked on signup/login
- [x] Customers/Suppliers: add directly from the Sales/Purchases screens
- [x] Full app: Dashboard, Sales, Purchases, Receivables (+ comm log),
      Payables, Cash & Bank, Users & Permissions — all real data
- [ ] No actual invite email is sent - the invited person has to be told
      separately to go sign up. Real email invites need a Supabase Edge
      Function + email service (a solid v2 addition, more infra).
- [ ] No UI yet for creating new invoices/bills/bank transactions directly -
      only customers/suppliers can be added from the UI so far.
- [ ] RLS currently lets any *active* firm member send an invite, not just
      Owners - the UI hides the button from non-Owners, but a technically
      savvy non-Owner could still call the API directly. Worth tightening
      later with a role-aware RLS policy.
