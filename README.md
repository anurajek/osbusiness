# Ledger OS

Multi-tenant accounting CRM — cashflow forecasting, sales, purchases, AR/AP, and cash & bank, built for firms managing multiple client books.

## Stack
- React + Vite
- Tailwind CSS v4
- Supabase (Postgres + Auth + Row Level Security)

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in your real Supabase URL + anon key
3. Run `ledger_os_schema.sql` then `migration_multitenant.sql` in Supabase's SQL Editor
4. Enable Email auth: Supabase → Authentication → Providers
5. `npm run dev`

## Onboarding a new firm

Login screen → "New here? Create your firm." Creates the account and firm together, auto-Owner.

## Inviting a teammate

Users & Permissions → "Invite a teammate." Tell them to sign up/log in with that
exact email — they're linked automatically (no invite email sent yet, that's
a future addition needing a proper email service).

## Status

- [x] Self-service signup, team invites, customer/supplier creation
- [x] Full app: Dashboard, Sales, Purchases, Receivables (+ comm log),
      Payables, Cash & Bank, Users & Permissions — all real data
- [x] Status is now **calculated automatically** everywhere (Sales,
      Purchases, Receivables, Payables, Dashboard) from the actual amount,
      amount paid, and due date - not a manually-picked field. Overdue
      flips on its own once a due date passes, Partial/Paid follow from
      how much has actually been paid. Nothing to remember to update.
- [x] "Record payment" quick action on every invoice/bill row - enter the
      amount received, status updates automatically, no need to open Edit
- [x] Create **and edit** sales invoices and purchase bills directly from
      the UI (Sales/Purchases screens → "+ New invoice"/"bill", or "Edit"
      on any existing row — same form, prefilled)
- [ ] No deleting of invoices/bills yet - only creation and editing
- [ ] No invite email sent - invited person must be told separately
- [ ] RLS lets any active member send an invite, not just Owners (UI hides
      the button, but the API itself doesn't enforce it yet)
