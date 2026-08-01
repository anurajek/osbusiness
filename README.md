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

If a user is already authenticated (has a Supabase Auth account) but belongs
to zero firms — e.g. an account created directly in the Supabase dashboard,
or one where firm creation failed after the auth step succeeded — they now
see a "Set up your firm" form in-app instead of a dead-end message, and can
create their firm right there without re-registering.

## Inviting a teammate

Users & Permissions → "Invite a teammate." They're linked automatically the
moment they sign up/log in with that exact email. As of the "Invite emails"
section below, they're also emailed directly (once that section's one-time
setup is done) - until then, tell them about the invite separately.

## Invite emails

Inviting a teammate sends them a real email now, via a new Supabase Edge
Function (`supabase/functions/send-invite-email/index.ts`) that calls
[Resend](https://resend.com) (free for up to 3,000 emails/month, no card
needed to start). This needs a one-time setup before it'll actually send:

1. **Create a Resend account** at resend.com and grab an API key
   (Dashboard → API Keys → Create API Key).
2. **Deploy the function** — no CLI needed:
   - Supabase Dashboard → **Edge Functions** → **Create a new function**
   - Name it exactly `send-invite-email`
   - Paste in the contents of `supabase/functions/send-invite-email/index.ts`
   - Deploy
3. **Add the secret** — Supabase Dashboard → Edge Functions →
   **Manage secrets**, add:
   - `RESEND_API_KEY` = the key from step 1
   - Optional: `INVITE_FROM_EMAIL` = `"Ledger OS <you@yourdomain.com>"` once
     you've verified a domain in Resend — until then it falls back to
     Resend's shared `onboarding@resend.dev` sender, which works
     immediately but looks less official.

Until this is set up, invites still work exactly as before — the
`firm_members` row is what actually grants access, the email is just a
courtesy notification. If the email fails to send (including "not set up
yet"), the invite form tells you so and asks you to notify them manually,
instead of pretending the email went out.

## Status

- [x] Self-service signup, team invites, customer/supplier creation
- [x] Self-heal for an authenticated-but-firmless account: the old
      "No firm linked yet" dead-end (which told you to go edit Supabase's
      firm_members table by hand) is now a real "Set up your firm" form
      that creates the firm and Owner membership for the current session
- [x] Fixed a race condition in self-service signup: Supabase's auth-session
      event fires right after account creation but *before* the firm and
      Owner-membership rows are actually inserted. The app used to switch
      into the main view during that gap and show the no-firm dead-end (or
      silently drop the error if firm creation actually failed). A
      `provisioning` flag now keeps a "Setting up your firm…" screen up
      until firm creation genuinely finishes, and any real failure is
      carried into the "Set up your firm" self-heal form instead of being
      lost

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
- [x] Add **and edit** cash/bank accounts directly from the UI (Cash & Bank
      → "+ New account", or "Edit" on any existing account card)
- [x] "Record payment" now asks which account the money moved through -
      it creates a real transaction on that account and updates its
      balance automatically, alongside marking the invoice/bill paid
- [x] Fixed the real cause of "new row violates row-level security policy for
      table firms" on firm creation: the client was doing
      `insert().select().single()`, and Postgres checks a RETURNING row
      against the table's *SELECT* policy, not just the INSERT policy - a
      brand-new firm has no membership row yet, so that SELECT check always
      failed. Firm + Owner-membership creation now happens inside a single
      `create_firm_with_owner()` SECURITY DEFINER function
      (`migration_create_firm_rpc.sql`), which bypasses this entirely and is
      atomic as a bonus - both rows or neither, always
- [ ] The invoice-update + transaction-insert + balance-update aren't
      wrapped in a single database transaction - if one step fails after
      an earlier one succeeded, you'll get an error telling you to check
      Cash & Bank manually rather than a silent inconsistency. A proper
      fix would move this into a Postgres function; noted as a solid
      next hardening step, not done yet.
- [x] Dashboard has one **Cash Flow** trend chart (the earlier separate
      "6-week forecast" chart was removed to avoid showing two overlapping
      cashflow views) — historical incoming/outgoing/balance reconstructed
      from real bank transactions, with a period picker styled to match
      the rest of the app: This Fiscal Year, Previous Fiscal Year (India's
      Apr-Mar year), or Last 12 Months
- [ ] No deleting of invoices/bills/accounts yet - only creation and editing
- [x] Owners can edit the firm's name and GSTIN from Users & Permissions →
      "Firm details" - updates everywhere the firm name/GSTIN is shown
      (topbar, firm switcher) since it refreshes the shared firm data on save
- [x] Owners can remove a team member (or cancel a pending invite) from
      Users & Permissions - asks for confirmation first. An Owner-role row
      and your own row can't be removed from the UI, so a firm can't be left
      without its Owner or have someone accidentally remove themselves
- [x] Firm details is now read-only by default with an "Edit" link to open
      it, rather than two permanently-open input fields - and Save is
      disabled unless something actually changed, so there's no accidental
      no-op save
- [x] Invite emails: inviting a teammate now actually sends them an email
      (not just a row in the database) via a new Supabase Edge Function,
      `send-invite-email`, using Resend. **Needs one-time setup before it
      works live** - see "Invite emails" above. Until that setup is done,
      invites still work exactly as before (the person can still be told
      manually); the invite form just shows that the email couldn't be sent
      instead of silently pretending it worked.
- [ ] RLS lets any active member send an invite or remove a member, not just
      Owners (UI hides these actions for non-Owners, but the API itself
      doesn't enforce it yet)

