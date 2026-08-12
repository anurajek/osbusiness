# FinoPilo Flow — Your Financial Co-Pilot

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
   - Optional: `INVITE_FROM_EMAIL` = `"FinoPilo Flow <you@yourdomain.com>"` once
     you've verified a domain in Resend — until then it falls back to
     Resend's shared `onboarding@resend.dev` sender, which works
     immediately but looks less official.

Until this is set up, invites still work exactly as before — the
`firm_members` row is what actually grants access, the email is just a
courtesy notification. If the email fails to send (including "not set up
yet"), the invite form tells you so and asks you to notify them manually,
instead of pretending the email went out.

## General Ledger (Chart of Accounts, Journal Entries, Reports)

A real double-entry ledger, separate from Sales/Purchases/Cash & Bank. Run
`migration_general_ledger.sql` once in Supabase's SQL Editor (after
`migration_create_firm_rpc.sql`, which it extends) - it's additive, safe to
run on the existing database.

**Chart of Accounts** - every firm gets 10 standard starter accounts
automatically (Cash, Bank, Accounts Receivable, Accounts Payable, GST
Payable, Owner's Equity, Retained Earnings, Sales Revenue, COGS, Operating
Expenses) - new firms get these on creation, existing firms got them
backfilled by the migration. Add more anytime from Ledger → Chart of
Accounts.

**Journal Entries** - every entry needs at least two lines and must balance
(total debits = total credits) - this is enforced twice: once in the UI
before you can submit, and again inside the database function that actually
creates the row, so a bad entry can't get in even by a client bug. New
entries start as **draft**; only an Owner can **Post** one, and once posted
it's permanent - no edit or delete, only a new correcting entry, same as
real bookkeeping. A draft can be freely deleted if it was wrong.

**Reports** - Trial Balance, Profit & Loss, and Balance Sheet, computed
directly from posted journal entries only (drafts never affect them). P&L
uses a fiscal-year picker (India's Apr-Mar year); Trial Balance and Balance
Sheet use an "as of" date. The Balance Sheet rolls unposted net
income/expense into a computed "Current Earnings" line in Equity - the same
way QuickBooks/Tally show an interim balance sheet before formal year-end
closing entries exist (this module doesn't have a closing-entries step yet).

**Deliberately not done yet, and worth knowing:**
- Sales/Purchases/Cash & Bank don't auto-post to the ledger. Recording an
  invoice or a payment doesn't create a journal entry - the ledger is a
  standalone, manually-operated module for now. Wiring auto-posting in
  (invoice created → Dr Accounts Receivable / Cr Sales Revenue, payment
  received → Dr Bank / Cr Accounts Receivable, etc.) is the natural next
  step, deliberately left out of this pass rather than retrofitting it onto
  the existing invoice/payment code in the same change.
- A draft entry's lines can't be edited once created - delete and recreate.
- No GST/tax-code awareness in journal entries yet (that's its own phase).
- Access to the whole module is gated by a new "Ledger" permission toggle
  in Users & Permissions, off by default for new Accountant/Viewer invites
  (it's more sensitive than day-to-day Sales/Purchases) - an Owner can turn
  it on per person.

## Branding, invoice numbering, and PDFs

Run `migration_branding_numbering.sql` in Supabase's SQL Editor - additive,
safe on the existing database. Adds:

- **Firm branding** — address, phone, business email, a logo URL (paste a
  link to a hosted image; there's no upload yet, that needs Supabase
  Storage set up first - see Status below), and free-text payment
  instructions (bank details / UPI / whatever), all editable from Users &
  Permissions → Firm details.
- **Real invoice numbering** — each firm gets its own prefix (default
  `INV-`) and an atomically-incrementing counter. Leave the invoice number
  blank when creating a **sales** invoice and it auto-fills as e.g.
  `INV-0007` — type your own and that's used instead. Purchase bills stay
  manual, deliberately: that number comes from the vendor, not from us.
- **Download PDF** — every invoice/bill row has a PDF download button now.
  Single-page, shows firm branding, Bill To details, dates, amount/paid/
  balance, status, and payment instructions if set. Generated entirely in
  the browser (via `jspdf`, lazy-loaded only when you click Download so it
  doesn't bloat the app's normal page load).

**Known limitation:** invoices/bills are still single-amount records, not
itemized line items (no qty/rate/description breakdown) - the PDF reflects
that honestly with one summary line rather than faking a breakdown that
doesn't exist in the data. Proper line-item invoicing is a bigger schema
change, and pairs naturally with Quotations when that phase happens.

## Quotations

Run `migration_quotations.sql` in Supabase's SQL Editor — additive, safe on
the existing database (also re-applies `create_firm_with_owner()` with a
`quotes` permission key added, same pattern as when Ledger was added).

The first itemized document in the app — Description/Qty/Rate/Amount per
line, with the amount computed by the database itself (a `generated always
as` column), not just trusted from the client. Quotes get their own
prefix/counter (`QUO-0001`, ...) via the same atomic-numbering pattern as
sales invoices.

**Workflow:** Draft → Sent → Accepted/Declined. A quote past its
`valid_until` date shows as "Expired" automatically (computed for display,
same pattern as invoice/bill status) without changing what's actually
stored. **Accept a quote → Convert to Invoice** creates a real sales
invoice for the quote's line-item total, auto-numbered, and marks the quote
`converted` — the line-item detail stays on the quote (and its PDF); the
resulting invoice is still single-amount for now, since invoices themselves
aren't itemized yet.

**Why quotes got line items before invoices did:** it's a brand-new table
with no existing data to risk — safer to prove the itemization pattern out
here first, then extend it to `sales_invoices`/`purchase_bills` as a
follow-up once it's stood up correctly. That follow-up would also finally
let invoice PDFs show a real breakdown instead of the single summary line
they show today.

## Credit / Debit Notes

Run `migration_credit_debit_notes.sql` in Supabase's SQL Editor — additive,
safe on the existing database (also re-applies `create_firm_with_owner()`
with a `notes` permission key, same pattern as Ledger/Quotations).

A credit note (issued to a customer) or debit note (issued to a supplier)
is its **own independent record** — creating or refunding one never edits
the amount/paid_amount on the invoice/bill it's optionally linked to. That
link (`original_invoice_id`/`original_bill_id`) is context for the audit
trail only. This is deliberate and matches how it actually works: if a
fully-paid invoice later needs a partial refund, the invoice is still
correctly "Paid" (the customer did pay it) — the refund is its own
transaction sitting alongside it, not a rewrite of history.

**"Record Refund"** does real money movement through Cash & Bank, same
mechanics as "Record Payment" on invoices/bills — a `bank_transactions` row
plus an account balance update. The direction is the one easy-to-get-wrong
part: a **credit note** pays money *back to* a customer, so refunding one
is cash **out** (same direction as a purchase payment); a **debit note**
gets money *back from* a supplier, so refunding one is cash **in** (same
direction as a sales payment) — i.e. the opposite of what "credit vs debit"
suggests at a glance. Both the migration file and `CreditDebitNoteScreen.jsx`
have the full reasoning in comments right where the sign is set.

Each note type gets its own auto-numbering (`CN-0001`, `DN-0001`, ...),
same atomic pattern as invoices and quotes, and its own branded PDF.

## Scope: AR/AP focus (Aug 2026)

This app is now scoped as an **accounts receivable/payable collections
tool** first, not a full accounting suite - closer to its original purpose
(replacing a spreadsheet-based collections workflow) than the broader
Zoho/QuickBooks-style direction explored earlier.

**Quotations, Credit/Debit Notes, and the General Ledger are hidden from
navigation, not deleted.** Every table, migration, RLS policy, and screen
for all three still exists exactly as built - nothing was dropped, and
there's zero data loss if any of them already had real records in them.
Re-enabling any of them is a small, safe change: add the module back to
the `MODULES` list in `src/components/AppShell.jsx` (nav) and
`src/screens/PermissionsScreen.jsx` (the per-member toggle grid) - two
array entries, no migration needed.

## Import Data

Run `migration_import.sql` in Supabase's SQL Editor — additive, safe on the
existing database.

Bulk-import **Customers, Suppliers, Sales Invoices, or Purchase Bills**
from a CSV export — built specifically so data already sitting in Tally,
Zoho Books, or a plain spreadsheet doesn't have to be re-typed by hand.

**Why CSV-only, no Excel (.xlsx) upload:** the standard npm package for
parsing Excel files (`xlsx`/SheetJS) has a known high-severity
vulnerability (prototype pollution + ReDoS) with **no fix currently
available**. Rather than ship a vulnerable file parser into a tool that
handles real financial data, this only supports CSV - which every
candidate source (Tally, Zoho Books, Excel itself via "Save As") can
export/convert to in one step anyway, so very little real capability is
lost for a meaningfully safer dependency footprint.

**How it works:**
1. Choose what you're importing, upload a CSV
2. Match each required field to a column from your file (auto-guessed from
   the column names, fully editable)
3. Preview every row with per-row validation (missing fields, unparseable
   dates/amounts) before anything touches the database — invalid rows are
   shown clearly and simply skipped, not silently dropped
4. Importing Sales Invoices/Purchase Bills auto-creates any customer/
   supplier name that doesn't already exist (matched case-insensitively)

**Every import can be undone.** Each import is grouped under an
`import_batches` record, and every row it creates (including any
auto-created customers/suppliers) is tagged with that batch's id. "Recent
Imports" lists past imports with an Undo button that deletes everything
that batch created. This needed its own narrowly-scoped delete policy,
since the app has otherwise deliberately never allowed deleting a
manually-entered invoice/bill/customer/supplier (see Status below) — the
new policies only allow deleting a row when `import_batch_id is not null`,
so manually-entered records stay exactly as protected as before.

**Duplicate detection:** before anything is imported, every row is checked
two ways - against every matching invoice #/bill #/name already in your
books, and against every other row in the same file (catches an export
that lists the same invoice twice, or accidentally uploading the same file
a second time). Either kind shows up in the preview as a skipped row with
a clear "Duplicate" reason, rather than silently creating a second copy.

**Known limitation:** the import isn't wrapped in a single database
transaction (batch record → party creation → document rows are three
separate calls) - if it fails partway through, Undo cleanly removes
whatever did get created, but this is a "recover via Undo" model, not true
atomicity. Reasonable for a first version; a `security definer` RPC doing
the whole import server-side (same pattern as `create_journal_entry`)
would be the way to make it fully atomic later if needed.

## Cash & Bank corrections

Run `migration_bank_txn_links.sql` in Supabase's SQL Editor — additive,
safe on the existing database.

Two related gaps, fixed together:

**Editing an existing invoice/bill's "Already paid" amount used to silently
desync Cash & Bank.** "Record Payment" always correctly created a bank
transaction and updated the account balance — but the general Edit form let
you change "Already paid" directly too, and that path never touched Cash &
Bank at all. "Already paid" is now **read-only when editing an existing
invoice/bill** — it can only be set at creation (for a historical record
predating this system) or changed via "Record Payment" afterward, so the
cash ledger can no longer drift out of sync with what an invoice/bill
claims was paid.

**There was no way to delete a bank transaction at all.** Unlike invoices/
bills/journal entries (deliberately protected — see Status below), the cash
ledger is the one place a direct correction makes sense: if a payment was
logged wrong, deleting it and recording it again correctly is the right
fix, not living with a permanently wrong entry. Every transaction row on
Cash & Bank now has a **Delete** button that properly reverses everything
it did:
- The account balance is reversed back
- If it came from "Record Payment," the linked invoice/bill's "already
  paid" amount is reduced back down and its status recalculated
- If it came from "Record Refund" (Credit/Debit Notes), the linked note is
  set back to "Open"

This only works correctly going forward for transactions created *after*
this migration — transactions that already exist (created before the link
columns existed) can still be deleted, but won't auto-reverse a linked
invoice/bill/note since there's no link to follow. Their account balance
still reverses correctly either way.

## Payment dates + CSV/PDF exports

No migration needed for this one - just deploy.

**"Record Payment" and "Record Refund" now ask which date the money actually
moved**, defaulting to today but fully editable — previously both always
silently used "right now," so recording a payment a few days after it
actually happened would show the wrong date in Cash & Bank.

**Export CSV / Export PDF** buttons added to Cash & Bank's transaction
list, and to Receivables/Payables' pending-clients/pending-suppliers lists
— each exports exactly what's currently filtered on screen (respecting the
period, search, and filter selections already applied), not the whole
unfiltered table. CSV opens natively in Excel; PDF is a clean landscape
report with your firm's name in the header. Same reasoning as the CSV-only
import: this app avoids the standard Excel-writing library too (same known
vulnerability, no fix available), so exports are CSV rather than a native
`.xlsx` file — Excel opens a CSV exactly the same as opening a native file.

**Receivables/Payables' Status filter now includes "Paid"** alongside the
open statuses (Sent/Partial/Due today/Overdue), instead of Paid living in a
separate report. Selecting it turns the same "Pending clients"/"Pending
suppliers" table into a paid view - "Open bills" becomes "Paid invoices,"
"Amount due" becomes "Amount received," same Export CSV/PDF either way.
(An earlier version of this added a second, separate "Payments Received"
table instead — simpler now to have one table whose meaning follows
whatever status is selected, rather than two different reports.)

**Export CSV/PDF also added directly to Sales, Purchases, Quotations, and
Credit/Debit Notes** — each exports whatever's currently filtered on that
screen. This closes the actual gap: filtering Sales to Status = Paid
previously only gave you individual per-invoice PDF downloads, one at a
time, with no way to export that filtered list as a single report.

## Export as: Excel / PDF / Word, and a real PDF bug fix

**The actual cause of "Export PDF does nothing":** every PDF export loaded
the `jspdf` library via a dynamic `import()`, which puts a gap - waiting
for the chunk to load - between the click and the actual file save. Some
browsers treat a save that happens after that gap as no longer tied
closely enough to the original click and silently drop it. `jspdf` (and
`docx`, added below) are now static imports instead, so generating and
saving the file happens in one synchronous pass with no gap - the browser
never has a reason to second-guess whether it was really user-initiated.

**Tradeoff, stated plainly:** this makes the main JS bundle meaningfully
bigger (roughly 900KB → 1.7MB) - static imports mean these libraries load
on every page visit instead of only when Export is actually used. Given
the alternative was a genuinely broken feature, that's the right trade,
but it's real and worth knowing about rather than glossing over.

**Word export added**, using the `docx` library (checked for known
vulnerabilities before adding it - none found, same diligence as every
other dependency in this app). Every list export (Cash & Bank, Receivables/
Payables, Sales, Purchases, Quotations, Credit/Debit Notes) now produces a
real `.docx` file with a formatted table, not just CSV/PDF.

**One "Export as" dropdown replaces the separate Export CSV/PDF buttons**,
moved into the shared filter row right next to "Sort by" (same row, right
edge) instead of sitting in each table's own header. Picking Excel, PDF, or
Word from it immediately triggers that export - it's an action menu, not a
persistent selection, so it always resets rather than staying "picked."
This lives in the shared `FilterBar` component (`exportOptions` prop), so
every screen gets the same placement and behavior automatically.

## Polish: placeholders, Import UI, real logo upload

Run `migration_firm_logo_storage.sql` in Supabase's SQL Editor for the logo
upload part — additive, safe on the existing database. The other two fixes
need no migration, just deploy.

**Signup placeholder bug fixed.** Both "Create your firm" (new signup) and
the "Set up your firm" self-heal screen had "Anuraj" and "NyooKart Apparel"
hardcoded as the Your Name/Firm Name field placeholders — leftover example
text from early scaffolding that would've shown up for literally anyone
else signing up. Now generic ("Your full name" / "Your firm's name").
Worth having caught this now rather than after this became something
other businesses actually use.

**Import Data's "What are you importing?" selector** is now a dropdown
matching the same filter-bar style used everywhere else in the app (label
+ select, right where "Sort by"/"Export as" live on other screens),
instead of a standalone row of tab buttons that didn't match anything else.

**Real logo upload**, replacing the old "paste a URL to an image hosted
somewhere else" text field. Users & Permissions → Firm details → Logo now
takes an actual PNG/JPEG/JPG file (2MB limit), stored in a new public
Supabase Storage bucket (`firm-logos`) at `{firm_id}/logo.{ext}` — the RLS
policies on that bucket check firm membership via that path, so a firm's
members can only upload/replace/remove their own logo, never another
firm's. The bucket is public (readable via a plain URL, no auth) since
that's exactly the trust level the old URL-paste approach already had —
logos need to be plain-URL-fetchable for the in-browser PDF generator and
the topbar regardless. A cache-busting query string is appended on each
upload so replacing a logo shows immediately instead of a stale cached copy
at the same path.

## Fixed: invited teammates ending up as Owner of a new firm

Run `migration_fix_invite_linking.sql` in Supabase's SQL Editor — additive,
safe on the existing database.

**The actual bug:** the only signup screen is "Create your firm," which
always creates a brand-new company and makes the signer-upper its Owner.
An invited teammate had no separate "accept invite" path, so using this
same form (the only one that exists) made them Owner of an accidental new
firm instead of joining yours as the role you'd assigned.

**A second, deeper bug underneath that:** the mechanism meant to link an
invited person to the firm that invited them (matching their email against
a pending `firm_members` row) queried that table directly from the client
— but that table's RLS only lets you see rows in firms you're *already* an
active member of. A pending invite has no `user_id` yet, so that check
could never actually see the very row it existed to find. This was likely
broken before this fix too, independent of which screen anyone used.

**The fix:** invite-linking now goes through a `security definer` database
function (`link_pending_invites()`) that looks up the caller's own verified
email server-side and claims only invite rows matching it exactly —
sidesteps the RLS catch-22 entirely, the same pattern already used for
`create_firm_with_owner()`/`create_journal_entry()` elsewhere in this app.
Signup now calls this *first*: if it finds and claims a pending invite,
it joins that firm and skips creating a new one - whatever was typed into
"Firm Name"/"GSTIN" is simply unused in that case. No new screen needed;
the existing signup form now does the right thing automatically based on
which email is used.

## Real invite acceptance flow (token-based, Zoho-style)

Run `migration_invite_token_flow.sql` in Supabase's SQL Editor - additive,
safe on the existing database. Redeploy `send-invite-email` with the
updated code in `supabase/functions/send-invite-email/index.ts` (it now
needs a `token` in the request body to build the right link).

The email-matching auto-join from the previous fix worked, but the link
itself just pointed at the app's plain homepage - whoever clicked it saw
the same generic login/signup screen as anyone else, with no indication
they'd been invited or by whom. Every invite now gets its own unique link
(`{APP_URL}/?invite={token}`) that leads to a dedicated page modeled
directly on how Zoho and similar products do this: shows the firm name,
who invited you, and which role you're joining as, then a signup form
already locked to that one email - just a password, nothing else to fill
in or get wrong.

**What it handles:**
- **Normal case** - not signed in, opens the link → sees firm/inviter/role
  → sets a password → lands directly in that firm with that role. Never
  creates or touches any other firm, by construction (this path doesn't
  call `create_firm_with_owner` at all).
- **Already signed in as that exact email** (e.g. re-opening their own
  invite link) - skips the password form, one button to join directly.
- **Already signed in as a *different* email** - clearly says so and asks
  them to sign out first, rather than silently doing something surprising.
- **Decline** - rejects the invite right from the landing page, before
  ever creating an account, same as the reference flow this is modeled on.
- **Invalid/reused link** - a plain, honest "this invite isn't valid
  anymore" instead of a confusing error or a dead end.

**Security note:** the token itself (a random UUID) is already hard to
guess, but `claim_invite_by_token()` also independently verifies the
signed-up account's *actual* email matches the invite's `invited_email`
server-side - a stolen/forwarded link still can't be claimed by the wrong
person, since whoever clicks it has to sign up with the exact invited
email address for the claim to succeed at all.

The email-based auto-detection from the previous fix (`link_pending_invites`)
stays in place underneath this as a fallback - it still runs on every
login/signup regardless of which link someone used, so an old-style
invite (sent before this migration) still resolves correctly too.

## PDF preview (Sales & Purchases)

No migration needed — just deploy.

Clicking the PDF action on a Sales invoice or Purchase bill now opens a
**Preview** modal showing the actual generated PDF inline, instead of
downloading it straight away. It's the real document rendered in the
browser's own PDF viewer (via a `blob:` URL in an iframe) — not an HTML
approximation that could end up looking different from what actually
downloads. A Download button inside the modal saves that exact same file.

Under the hood, every PDF generator in `lib/pdf.js` (invoices/bills,
quotes, credit/debit notes, and the tabular list exports) is now split
into a `build*Pdf()` that constructs the document and a pair of thin
wrappers — `download*Pdf()` (saves it immediately, same as before) and
`preview*Pdf()` (returns a `blob:` URL for showing it inline) — both
drawing from the exact same code, so preview and download can never
drift apart. Preview is wired up on Sales/Purchases for now; the same
`preview*Pdf()` functions already exist for Quotations and Credit/Debit
Notes if you want the same treatment there later.

## Proforma Invoices + Payment Reminders

This is the biggest single addition to the app so far, and needs a few
setup steps — read this whole section before deploying.

**The core idea:** this tool never generates or converts either Proforma
Invoices or Tax Invoices — that stays in Zoho/Tally/whichever accounting
software a firm already uses. Both document types arrive here the same
way, via CSV import, and are tracked **side by side**, not one converting
into the other, because different firms follow up differently: some chase
the PI, some skip straight to the Tax Invoice, some do both.

### Proforma Invoices

A new import type (Import Data → "Proforma Invoices"), a `proforma_invoices`
table mirroring Sales Invoices closely (customer, PI #, issued date,
amount, paid amount) but **without a due date** — "overdue" for a PI is
always computed from the firm's payment-due setting (see below), not a
stored date, since a proforma invoice doesn't carry its own due date the
way a tax invoice does.

### AR/AP → two new tabs: Invoice Follow-up / PI Follow-up

Alongside the existing Receivables/Payables (which stay as customer-level
rollups), two new tabs give the **per-document** view this needed: one row
per pending Invoice or PI, with exactly what you asked for — customer,
document #, issued date, amount pending, days overdue, and reminder
status — plus Pause/Resume and Send Now right there, and the same
Export CSV/PDF/Word every other list has.

**Payment due (days after issue)** is a new per-firm setting (Users &
Permissions → Firm details, default 7) — this is what "overdue" is
calculated against for both Invoices and PIs.

### Reminder emails — per customer, not per document

Click any row in Invoice/PI Follow-up to expand it and manage that
customer's reminder email list — add or remove addresses freely, any time.
Set once per customer, used for every pending document they have, rather
than re-entering the same emails for each invoice. If none are set, it
falls back to the customer's main email (from Sales).

### The reminder schedule

Exactly as specified — day 3 is a gentle nudge, the day before the payment
is due is a firmer reminder, the due date itself gets a due-today notice,
and every 2 days past that sends an overdue notice with the day count.
Reminders stop entirely once paused, or once the balance reaches zero.

### Manual send vs. automatic — both exist, and need separate setup

**Manual ("Send now")** works as soon as you deploy this update and the
Edge Function below — click it any time from day 3 onward and it sends
whatever stage currently applies.

**Automatic** (fires on its own, on schedule, every day) needs one more
piece: a **Supabase Cron Job**, because a scheduled send has to run
somewhere even when nobody has the app open — a browser tab can't do that
reliably. Setup:

1. **Deploy two new Edge Functions** (Supabase Dashboard → Edge Functions
   → Create a new function, for each):
   - `send-payment-reminder` — paste in
     `supabase/functions/send-payment-reminder/index.ts`. This is what the
     manual "Send now" button calls.
   - `send-payment-reminders-batch` — paste in
     `supabase/functions/send-payment-reminders-batch/index.ts`. This is
     what the daily cron job below calls. It also needs
     `supabase/functions/_shared/reminderLogic.ts` — Supabase's dashboard
     editor supports adding extra files to a function via "Add File" in
     the Files panel; add it there as `_shared/reminderLogic.ts` (one
     level up from the function's own `index.ts`) for **both** functions,
     since both import from it.
2. No new secrets needed — this reuses the same `RESEND_API_KEY` (and
   optional `INVITE_FROM_EMAIL`) already set up for invite emails, plus
   `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, which
   Supabase provides automatically to every Edge Function — nothing to
   add there.
3. **Schedule it**: Supabase Dashboard → Integrations → Cron (or Database
   → Cron Jobs) → create a new job → set it to invoke the
   `send-payment-reminders-batch` function once a day (any time works,
   e.g. 9:00 AM). Supabase's cron UI handles the actual scheduling; you're
   just pointing it at that one function.

Until step 3 is done, reminders only go out when someone clicks "Send
now" — which may be exactly right if you picked manual-first deliberately.
Automatic sending turns on the moment the cron job exists, no code change
needed on this end.

### What's deliberately not built yet

WhatsApp and SMS reminders — email was the explicit starting point, given
it reuses infrastructure already in place and needs no new account setup.
Both would need their own provider account (a WhatsApp Business API
provider needs Meta Business verification and pre-approved message
templates; SMS in India additionally needs DLT template registration) —
real, separate projects whenever you're ready to take them on.

## Receivables now includes Proforma Invoices, and Preview added to Follow-up

No migration needed for either — just deploy.

**Receivables was only ever showing Sales Invoice pending amounts** -
Proforma Invoices, even once imported, never contributed to the "Still
pending" total or any customer's "Amount Due," since the screen never
queried that table at all. Fixed: the stat cards and the "Pending
clients"/"Paid clients" list now combine both — a customer's total
reflects everything they owe, invoice or PI. One nuance worth knowing: the
Status filter's granular options (Sent/Partial/Due today/Overdue) are
Invoice-only, since a PI doesn't carry that same breakdown - only "All
open" and "Paid" pull in both together. The screen says so plainly
whenever a granular status is selected, rather than silently dropping PI
data with no explanation.

**Preview added to Invoice Follow-up and PI Follow-up** - same PDF preview
already on Sales/Purchases, now on these two screens as well, so you can
see the actual document without leaving the follow-up view. Proforma
Invoices get their own "PROFORMA INVOICE" title rather than being labeled
as a regular invoice.

## Itemized tax breakdown + manual workflow status + Follow-up screen upgrades

Run `migration_itemized_tax_and_manual_status.sql` in Supabase's SQL
Editor — additive, safe on the existing database.

### Real itemized + tax breakdown on PDFs

Sales Invoices, Purchase Bills, and Proforma Invoices now have optional
item/tax fields — description, quantity, rate, subtotal, discount, and
CGST/SGST/IGST rate+amount — mappable during CSV import just like every
other field. When mapped, the PDF preview shows a real itemized line and
tax breakdown (Items & Description / Qty / Rate / Amount, then Sub Total,
Discount, CGST, SGST, IGST, Total) instead of the plain single-total
summary. **This is one line item per document**, not a full multi-line
items table — matching what a CSV import can realistically carry (one
row = one document), and matching what the reference screenshot actually
showed (a single line item with a tax breakdown). Any document imported
without this data (or imported before this migration) renders exactly as
it always has — nothing required to keep using the app as-is.

### Manual workflow status — Sent / Overdue / Paid / Invoiced / Completed

Both a filter and a per-document setting, on Invoice/PI Follow-up:

- **As a filter**: pick any of the five in the Status dropdown to see every
  document tagged with it, regardless of whether it's still amount-pending
  — "Pending (default)" is what shows normally (the actionable, amount-
  based list, unchanged from before).
- **As a setting**: every row has its own Status dropdown, right in the
  table — set it directly, no extra screen. This is a separate, manual
  tracking dimension, not tied to the automatic amount/days-based pending
  and overdue calculations used everywhere else in the app — most usefully
  for "Invoiced" (this PI has now been converted to a real Tax Invoice
  over in the accounting software), which nothing in this tool could ever
  detect on its own.

### Invoice/PI Follow-up also got:

- **Stat cards** — "{Invoices/PIs} in period," "Collected in period,"
  "Still pending," matching what Receivables already shows, scoped to just
  this document type.
- **Actions as one dropdown** instead of three separate buttons crowding
  the row (Preview / Send reminder now / Pause / Resume / Log an update)
  — same "Export as" pattern already used elsewhere, picked specifically
  because the old stacked-button layout wrapped badly on narrower screens.
- **"Log an update"** now opens the same follow-up drawer (call/email/
  WhatsApp notes, promise-to-pay tags, communication history) already used
  on Receivables — it was simply missing from these two screens before.

## Cross-screen navigation - customer/supplier names are now real links

No migration needed - just deploy.

**Customer and supplier names are clickable** in Sales and Purchases - click
one and it jumps straight to Receivables/Payables, already filtered to
that exact customer/supplier, instead of landing on the full list and
making you search again.

**Receivables' row action is now "Actions..."** (matching Invoice/PI
Follow-up), not a single "View" button - View details (opens the same
update-log drawer as before), plus two new direct jumps: "Invoice
Follow-up →" and "PI Follow-up →", both landing pre-filtered to that
customer. The update-log drawer itself got the same two links added next
to its close button, so logging a note and then checking that customer's
PI/Invoice follow-up status is one click, not a re-navigation.

**Payables did not get the same treatment, on purpose, not by oversight**:
there's no underlying communication-log data model for suppliers the way
`ar_comms` exists for customers - Payables never had a drawer or an
"Actions" menu to begin with, so adding one now would mean either building
that whole feature (a real, separate piece of work) or adding a dropdown
that points at nothing. Payables *did* get the pre-filter-on-arrival part
(clicking a supplier in Purchases lands here filtered correctly), since
that reuses the same mechanism with no new data model required. Worth a
separate conversation if supplier-side follow-up tracking would be useful.

How this works, for future screens: `App.jsx`'s existing navigation
function now carries an optional `{ customerId }` or `{ supplierId }`
payload alongside the module/tab it's switching to. A screen that wants to
arrive pre-filtered accepts `navParams`/`clearNavParams` props, applies
the incoming id in an effect, then clears it - the same small pattern
used by Receivables, Payables, and Invoice/PI Follow-up here.

## Bill cancellation, Payables parity, deeper hyperlinks, send-reminder confirmation

Run `migration_bill_cancel_and_supplier_comms.sql` in Supabase's SQL
Editor — additive, safe on the existing database.

### Cancel a bill

Purchases now has a real "Cancel bill" action (Actions → Cancel bill),
asks for confirmation, and stays reversible ("Reinstate bill" undoes it).
A cancelled bill shows a **Cancelled** status pill and is completely
excluded from Payables — not just hidden, genuinely not counted toward
what's owed or what's been paid, the same way a deleted record wouldn't
count. The bill itself isn't deleted; it's still visible and filterable
via the Status dropdown.

### Payables now matches Receivables

This needed a real piece of missing infrastructure: there was no
communication-log table for suppliers at all (`ar_comms` only ever existed
for customers). Added `supplier_comms`, and with it, Payables gets exactly
what Receivables has - a "View details" action opening the same drawer
component (Bills + communication timeline + Log an update), a "Last
update"/"Last contact" column, and sorting by most recent contact.

### Deeper hyperlinking

Sales and Purchases rows now have the same "Actions..." dropdown pattern
as everywhere else (replacing the separate Record payment/Edit/Preview
buttons), and it's where the cross-navigation lives:
- **Sales**: Receivables →, Invoice Follow-up →, PI Follow-up → (all
  pre-filtered to that row's customer)
- **Purchases**: Payables →, plus Cancel bill

Clicking a customer/supplier name still works exactly as before too - the
Actions dropdown is an additional way to reach the same destinations, not
a replacement for it.

### "Send reminder now" shows the email before it sends anything

Instead of firing immediately, it now opens the same panel used for
managing reminder emails - showing exactly who this is about to go to,
letting you add an email right there if none exists (or the one on file
looks wrong), with an explicit **Confirm & Send** button. Nothing sends
until that's clicked. If a customer has no email anywhere (no reminder
email added, no main email on their record), it says so plainly instead
of letting you try to send into nothing.

## Row click on Invoice/PI Follow-up now matches Receivables/Payables

No migration needed - just deploy.

Clicking a row on Invoice/PI Follow-up previously opened the reminder-email
management panel - inconsistent with Receivables and Payables, where a row
click opens the Log-an-update drawer. Fixed: row click now opens that same
drawer everywhere. Managing reminder emails is still there, just moved to
an explicit "Manage reminder emails" option in the Actions dropdown,
rather than being what a plain click does by default.

## DSO & Collection Trends

No migration needed — just deploy. New AR/AP tab.

**A real data limitation, stated upfront**: textbook DSO (Days Sales
Outstanding) is a balance-sheet snapshot — outstanding AR against recent
sales, computed fresh each time. It cannot be reconstructed for *past*
months without historical daily AR balances, which this app has never
recorded. Rather than fake a "12-month DSO trend" using numbers that would
quietly be wrong, this screen is honest about the split:

- **DSO (trailing 90 days)** — a real, standard, correctly-computed
  snapshot, valid for right now: outstanding AR ÷ sales in the last 90
  days × 90.
- **The trend charts are a different, genuinely computable metric** — for
  invoices *issued* in each of the last 12 months, how many days they
  actually took to get paid (using the linked Cash & Bank transaction as
  the payment date), and what fraction of that month's invoiced amount has
  been collected so far. Not identical to DSO, but real, retroactively
  computable from data that already exists, and arguably more actionable
  — it answers "are we collecting faster or slower than we used to."

**Coverage caveat, shown directly in the UI**: an invoice marked paid at
creation/import time (rather than through Record Payment) has no linked
transaction, so it can't contribute a real days-to-collect number. Every
month's tooltip shows "X of Y paid invoices" so this is never hidden.

Scoped to Sales Invoices only — Proforma Invoices aren't recognized
revenue, so including them would misstate a financial metric.

## Real bugs found and fixed: PI in the drawer, double-counting, missing Cancel; plus DSO period filter and a global period-selector redesign

Run `migration_cancel_invoices_pi.sql` in Supabase's SQL Editor — additive,
safe on the existing database.

### The actual "PI not fetching" bug

Confirmed directly from the screenshot: CLIMAXO's update-log drawer said
"No open bills for this client" despite a genuine ₹97,940 pending PI. The
cause — Receivables' drawer only ever built its Bills list from Sales
Invoices, even after Receivables itself started combining both months ago.
Fixed: the drawer now shows both, correctly.

### The double-counting bug behind "PI not moving to Invoice"

A real design gap, not what it first looked like. Marking a PI's manual
status "Invoiced" was purely cosmetic — it didn't stop that PI's amount
from still counting as pending. That's a genuine problem: once the real
Tax Invoice for that same receivable gets imported too, the PI *and* the
Invoice would both count toward "still pending," double-counting the same
money owed. Fixed with a new shared rule
(`isResolved()` in `lib/format.js`): a document stops counting toward any
"still owed" figure the moment it's cancelled, fully paid by amount, *or*
manually tagged Paid/Invoiced/Completed. Applied consistently everywhere a
pending total exists — Receivables' stat cards and pending list, both
Follow-up screens, and DSO's outstanding-AR figure. The document itself
never disappears — it's still fully visible and taggable on its own
Follow-up screen, which has its own status filter for exactly this.

### Cancel, extended to Invoices and Proforma Invoices

Was Purchase-Bills-only. Now available the same way (Actions → Cancel) on
Sales Invoices and Proforma Invoices too — same void-not-delete behavior,
same exclusion from every pending calculation via `isResolved()`.

### DSO & Trends now has a period filter

Controls which months the two trend charts cover (All time/Last month/
Last quarter/Last year/Custom, same as everywhere else). The DSO stat card
itself stays "as of today" regardless of the period selected — a
balance-sheet snapshot can't meaningfully be shown "as of" a past period,
for the same reason the whole trend section exists instead of retroactive
DSO in the first place. The screen says this directly rather than leaving
it to guess why DSO doesn't move when the period changes.

### Period selector redesigned as a dropdown, everywhere at once

Changed once, in the shared `PeriodSelector` component
(`components/FilterControls.jsx`) — a row of pill buttons is now a single
dropdown, matching the Actions/Export-as dropdown style used throughout
the app. Because every screen with a period selector (Dashboard,
Receivables, Payables, Sales, Purchases, Cash & Bank, Invoice/PI
Follow-up, and now DSO & Trends) shares this one component, this one
change applies consistently everywhere without touching each screen
individually.

## Due Date column + Period moved next to Status

No migration needed — just deploy.

**Status folding into Actions (below, historical) was reverted** — see
"Status-setting reverted to a plain dropdown, and added to Receivables"
further down for the current, working behavior. Status on Invoice/PI
Follow-up is a direct, always-visible dropdown again.

**Due Date column added**, between Amount Pending and Days Overdue, on
both Invoice and PI Follow-up — computed from issued date + the firm's
payment-due setting, same number that drives the Days Overdue column right
next to it.

**Period moved into the same row as Status, everywhere** — like the
dropdown-style redesign a few updates back, this was fixed once in the
shared `FilterBar` component (it now accepts an optional `period` prop,
rendered right after the filter dropdowns) rather than per-screen, so it
applies consistently across Receivables, Payables, Sales, Purchases,
Cash & Bank, Quotations, Credit/Debit Notes, and both Follow-up screens
in one change. DSO & Trends keeps its own separate period row, since that
screen has no Status filter for Period to follow.

## Status-setting reverted to a plain dropdown, and added to Receivables

No migration needed — just deploy.

**The Actions-dropdown status picker (pill buttons in an expand panel) is
reverted.** It wasn't reliably working, and rather than keep debugging
something impossible to test live in this environment, Status is back to
being its own direct, always-visible dropdown on Invoice/PI Follow-up —
the same simple pattern that was already proven to work everywhere else
in the app. "Set status" is removed from the Actions menu since there's
no longer a separate picker for it to open.

**Receivables can now set the same status too**, from the update-log
drawer's Bills table — a new "Tag" column next to each open invoice/PI,
same five values (Sent/Overdue/Paid/Invoiced/Completed). This isn't a
separate synced copy of the status — Receivables and Invoice/PI Follow-up
read the exact same `sales_invoices`/`proforma_invoices` rows, so setting
it from either screen shows up on the other automatically the next time
that screen loads. No sync mechanism needed or built, because none was
needed — it was always meant to be the same underlying value.

One expected side effect worth knowing, not a bug: once a document is
tagged Paid/Invoiced/Completed, it drops out of the drawer's Bills list on
its next refresh (that list only shows currently-pending items, and a
resolved one is deliberately no longer pending). To undo a tag, use
Invoice/PI Follow-up's own Status column, which still shows every
document regardless of resolution state.

## Forgot password, change password, and a small cleanup on Sales/Purchases

No migration needed — just deploy. Uses Supabase's own built-in auth email
system for password resets, not the Resend-based functions used elsewhere
— nothing to configure, it already works out of the box.

**Forgot password** — "Forgot password?" link on the login screen, right
next to the Password label. Sends a reset email via Supabase Auth; the
link brings them back into the app on a dedicated "Set a new password"
screen, which takes priority over normal login/dashboard routing the same
way an invite link does.

**Change password** — new "Your password" card at the top of Users &
Permissions, for anyone already signed in to change their own password
directly, no email round-trip needed.

**Sales/Purchases cleanup** — the "Customers"/"Suppliers" heading above
the add-party form is removed, and the "+ New customer"/"+ New supplier"
button is now a plain compact "+ Add".

## Multi-line CSV import merge, +Add repositioned again, password change restructured

No migration needed — just deploy.

### The real bug behind those "duplicate" errors

Confirmed from your screenshot: DESMA International's two rows weren't a
duplicate import — they were two line items of the *same* invoice
(EST/225/26-27), which is exactly how Zoho's export puts one CSV row per
line item, repeating the invoice number and total on each one. The import
had no way to tell "same invoice, different line" apart from "actual
duplicate," so it rejected the second row outright.

**Fixed properly**, not worked around: rows sharing the same Invoice #/PI
#/Bill # are now merged into one document before any duplicate check
runs. The merge uses the shared invoice-level total (validated to actually
match across every row for that document — if it doesn't, that's a real
data problem and now says so explicitly, rather than silently picking one
number), sums whatever subtotal/discount/CGST/SGST/IGST fields are
present, and combines the item descriptions into one field. Quantity and
rate are dropped specifically for merged rows — summing a quantity or a
rate across different line items doesn't mean anything real, so the PDF
falls back to showing the combined description against the correct total
rather than a fabricated single line. The preview table shows a "Merged
from N lines" tag on any row this happened to, so it's never invisible.

### +Add moved again — now on the right

Same `addAction` prop on the shared `FilterBar`, just repositioned to
render last instead of first, putting it on the right side of the row as
asked.

### Password change restructured to match Firm details

For Owners: "Your password" is no longer its own card — "+ Password
Change" now sits in Firm details' header corner, stacked under "Edit,"
opening the same form inline within that one card instead of a separate
block above it. For non-Owners (who don't see Firm details at all), a
small standalone "Your password" card is kept — otherwise they'd have no
way to change their password at all, since Firm details is Owner-only.

## A real "All", Partially Paid, and Cancelled joining the status vocabulary

Run `migration_partially_paid_status.sql` in Supabase's SQL Editor —
additive, safe on the existing database.

### Status filter (Invoice/PI Follow-up)

"All" is now the default, and it means what it says — literally every
document in the period, resolved and cancelled ones included. The old
default behavior (the amount-based, actionable list) didn't disappear —
it's "Pending" now, its own explicit option instead of hiding inside
"all." No more "(default)" suffix anywhere in the label.

### Partially Paid

A genuine new manual status, alongside Sent/Overdue/Paid/Invoiced/
Completed — available everywhere those are (the Status filter, the
per-row Status column, and Receivables' update-log drawer). Deliberately
does *not* remove a document from "still pending" totals — some of the
amount is still genuinely outstanding, so it keeps counting exactly like
the plain amount-based check already does on its own.

### Cancelled — routed to the real mechanism, not a second one

This one needed care rather than just adding a string to a list. This app
already has a real "cancelled" concept (`is_cancelled`, from a few updates
back) that correctly excludes a document from every total. Adding
"Cancelled" as *another* manual_status value would have created two
different, potentially conflicting ways to represent the same thing.
Instead, "Cancelled" in every status dropdown (Invoice/PI Follow-up's
Status column, Receivables' drawer Tag column) is wired to toggle
`is_cancelled` directly — same confirmation prompt, same real effect, as
the existing "Cancel invoice/PI/bill" action already had. Picking any
other status while a document is currently cancelled reinstates it in the
same update, rather than leaving it cancelled with a confusing tag
layered on top. The Log an Update tag list also gained a plain
"Cancelled" option, for noting what happened in a conversation — that one
stays a descriptive note only, same as every other tag there, and doesn't
touch `is_cancelled`.

### One shared list, not two copies

`MANUAL_STATUSES` moved into `lib/format.js` as the single source of
truth — Invoice/PI Follow-up and Receivables both import it now instead
of each keeping their own copy, so they can't drift out of sync with each
other again.

## Marking Paid now records a real payment, and PI-to-Invoice linking

Run `migration_pi_payment_linking.sql` in Supabase's SQL Editor —
additive, safe on the existing database.

### The real gap this closes

Marking something "Paid" via any status dropdown never actually touched
`paid_amount` — it was a text tag with zero effect on Collected in
period, Cash & Bank, or the DSO days-to-collect trend. Fixed properly:
picking **Paid** or **Partially Paid** anywhere (Invoice/PI Follow-up's
Status column, Receivables' drawer Tag column) now opens the same real
payment-recording flow Sales/Purchases' "Record payment" already has —
amount, which bank/cash account it landed in, and the date. On save: a
genuine `bank_transactions` row is created, the account balance updates
to match, `paid_amount` is bumped (added to whatever was already paid,
not overwritten — covers more than one partial payment over time), and
the status is set. Paid defaults the amount to the full outstanding
balance; Partially Paid starts blank since there's no sensible default.

### PI-to-Invoice linking, with automatic payment carry-over

This tool still never auto-creates or auto-converts a PI into an Invoice
— that's exactly the design decision from early on, and it hasn't
changed. What's new: once you've imported the *real* Tax Invoice
yourself, **Sales → Actions → Link to PI** lets you explicitly connect it
to the Proforma Invoice it came from. Linking:

- Copies the PI's `paid_amount` onto the invoice — but only if the
  invoice doesn't already have its own payment recorded, so real data is
  never silently overwritten. The screen says so directly if that's the
  case.
- **Re-points, not duplicates**, the PI's existing bank transaction to
  the invoice instead. The cash was only ever received once — creating a
  second transaction would double-count it in Cash & Bank. The original
  transaction's real date carries over too, which is genuinely more
  accurate for the DSO trend than the linking date would be.
- Tags the PI "Invoiced" as a courtesy, since that's exactly what linking
  means — this PI has now definitively become a real Tax Invoice.

## Two real bugs: stray Cash & Bank entries, and Link to PI showing nothing

No migration needed — just deploy.

### Stray transaction left behind after fixing a wrong entry

Confirmed the actual cause: Cash & Bank's "delete transaction" already had
a correct reversal mechanism (it reduces the linked document's paid
amount back down when you delete a transaction) — but it only ever knew
about `related_sales_invoice_id` and `related_purchase_bill_id`. It had
no idea `related_proforma_invoice_id` existed, since that column was
added later for PI payments specifically. Deleting a PI-linked payment
transaction correctly removed it from the account balance, but silently
left the PI's `paid_amount` untouched — exactly the stray, out-of-sync
entry described. Fixed: the delete flow now fetches and correctly
reverses PI-linked transactions the same way it already did for
Invoices/Bills.

**The correct way to undo a wrong payment entry** is to delete it from
Cash & Bank directly (now works correctly for PI too) — editing the bill
or PI's own fields afterward doesn't touch the transaction that was
already created, which is what led to the mismatch in the first place.

### Link to PI showing nothing

The actual bug: the picker only ever searched Proforma Invoices with an
*exact* `customer_id` match to the invoice's own customer. If the PI
export and the Invoice export ever produced two slightly different
customer records for what's really the same company — extra whitespace,
"Pvt Ltd" vs "Private Limited," a long name typed slightly differently
between two CSV exports — the match would silently return nothing, with
no indication why. Fixed: the picker now searches every open PI in the
firm, with its own search box (by PI # or customer name) to narrow it
down — slower to scan for a large firm, but it can never go silently
empty because of a customer-record mismatch it has no way to detect.

## Move to Invoice — a more direct alternative to Link to PI

No migration needed — just deploy.

A faster path to the same result "Link to PI" already gave you: **PI
Follow-up → Actions → Move to Invoice…**, right from the PI's own row,
instead of importing the invoice via CSV first and then finding it to
link separately. You type the real invoice number and date (this tool
still never invents one) — customer and amount come straight from the
PI, and whatever's already been paid carries over exactly as-is. No new
payment is created and nothing gets entered twice: any bank transaction
already linked to the PI is re-pointed to the new invoice, the same
re-point-not-duplicate approach Link to PI uses, for the same reason —
the cash was only ever received once. The PI gets tagged "Invoiced"
automatically once the invoice exists. Link to PI itself is untouched and
still there on Sales, for when the invoice already exists in your books
and just needs connecting after the fact.

## PI pending amount self-heals after its invoice is paid, and a real payment question in Move to Invoice

No migration needed — just deploy.

### The real cause of the stale PI pending amount

Confirmed exactly what happened: once a PI is linked to an invoice
(Move to Invoice or Link to PI), they become two separate database rows.
Recording a payment on the invoice afterward only ever updated the
invoice's own `paid_amount` — the PI's `paid_amount` was a one-time
snapshot from the moment it was linked, and nothing was written to
update it again. E-BEAMS INFO TECH's PI correctly showed "Invoiced," but
its Amount Pending column kept showing the full ₹41,300 forever, even
after the real invoice was fully paid.

**Fixed as self-healing, not a one-time correction.** PI Follow-up now
reads the linked invoice's *current* paid amount fresh on every load and
uses it in place of the PI's own frozen value — for the pending amount
shown, and for every calculation built on it (Still pending, whether it
counts as resolved). This wasn't a write-time sync added to the payment
flow (which would only prevent it going forward and still leave your
existing E-BEAMS PI wrong) — it reads live from the source of truth every
time, so an already-drifted PI corrects itself immediately with no manual
fix needed, and it can't drift again no matter which screen a future
payment gets recorded on. A small ⓘ next to the amount marks a PI that's
tracking a linked invoice this way, so it's clear where the number is
coming from.

### Move to Invoice now asks about payment directly

Previously the only way to record a payment on a just-created invoice was
a separate trip to Invoice Follow-up afterward — exactly the two-step
workflow described. Move to Invoice now has its own "Payment already
received for this invoice" question, right in the same form. Checking it
reveals amount/account/date, recorded as a genuinely new payment (its own
bank transaction) — kept clearly separate from whatever was already
carried over from the PI, so the two amounts are never confused or added
together in an untraceable way.

## The actual duplicate-payment mechanism, blocked at the source

No migration needed for the code fix — just deploy. There's a cleanup
step for existing data, described below.

### What was actually happening

Confirmed exactly from the DESMA example: recording a payment on a PI
*after* it was already linked to an invoice created a completely
independent second transaction — the PI side had no idea the invoice
existed, so nothing stopped it. The self-healing fix from last update
only corrected what gets *displayed* as a PI's pending amount; it never
stopped someone from creating a genuinely new, separate transaction on
the PI side of an already-linked pair. That's the real mechanism behind
the duplicate ₹88,500 entries.

**Fixed at the source, not with another display trick.** Trying to mark
a linked PI Paid/Partially Paid is now blocked outright, with a message
pointing to the actual linked invoice to use instead — this is where real
money would get double-counted, so it's a hard stop, not a suggestion.
Trying to "Move to Invoice" a PI that's already linked is blocked the
same way, since that would create a second invoice for the same PI. The
Actions dropdown also now shows "Already → GF/26-27/0218" directly on an
already-linked PI, so which ones are linked is visible before you even
try.

### Cleaning up the duplicates that already exist

This part needs your hand, since I can't reach into your live database —
only ship the fix and the tool to find them.

1. Run `find_duplicate_payments.sql` in Supabase's SQL Editor. It's
   read-only — it finds every PI-linked-invoice pair where *both* sides
   ended up with their own transaction (exactly your DESMA case), without
   deleting anything.
2. For each row it returns, go to **Cash & Bank** and delete the
   transaction whose description mentions the **PI number** (not the
   invoice number) — that's the stray one. Deleting through the UI matters
   here, not a raw SQL delete: it's what correctly reverses the account
   balance by the right amount, the same fix from a couple of updates ago.
3. For your DESMA example specifically: delete the "Payment received —
   EST/225/26-27" transaction, keep "Payment received — GF/26-27/0218."

## A second, different duplicate-payment mechanism, also closed

No migration needed for the code fix — just deploy. There's a cleanup
step for existing data, described below.

### What actually happened this time

A genuinely different bug from last update's fix, not the same one
recurring. This PI already had ₹47,200 carried over automatically during
Move to Invoice. The "payment already received" checkbox then recorded
whatever was typed into it as a brand new transaction — even though it
was the same ₹47,200 already accounted for by the carry-over. The
invoice's own `paid_amount` was correctly capped at the real total, but
the bank transaction itself wasn't, so ₹94,400 landed in the bank account
for money that was only ever ₹47,200.

**Fixed at the actual point of failure**: the new-payment transaction now
always uses the real *remaining* amount after the carry-over, capped the
same way `paid_amount` already was — not the raw number typed into the
box. Concretely: if the carry-over already covers the full invoice, that
box now correctly records nothing further, no matter what's entered into
it. The form's wording was also rewritten to say plainly that the
checkbox is only for money *beyond* what's already shown carrying over,
and the amount/account/date fields no longer even appear once a PI is
already fully paid, since there's nothing left to record at that point.

### Cleaning up what already exists

`find_duplicate_payments.sql` was rewritten to be more general — the
previous version only caught duplicates split across a PI-side and an
invoice-side transaction (last update's bug shape). This one instead
finds any invoice or PI where its linked transactions simply sum to more
than the document's own amount, which catches this new shape too (both
transactions ending up correctly linked to the invoice, just still two of
them). Run it, then in Cash & Bank, delete one of the two matching
transactions for each result it returns — for L D THE POWER SOLUTIONS
specifically, delete either the "EST/230/26-27" or "GF/26-27/0228" entry
(both ₹47,200) and keep the other.

## Status

- [x] **Second duplicate-payment mechanism found and closed (Aug 2026):** a
      genuinely different bug from the previous fix - "payment already
      received" in Move to Invoice recorded the raw typed amount as a new
      transaction even when the carry-over already covered it, since only
      `paid_amount` was capped, not the transaction itself. Now the new
      transaction always uses the real remaining amount after the
      carry-over - checking the box when nothing is actually owed beyond
      it correctly records nothing. `find_duplicate_payments.sql`
      rewritten to catch this shape too (any doc whose transactions sum
      past its own amount, not just one specific FK pattern). See "A
      second, different duplicate-payment mechanism, also closed" above.

- [x] **Duplicate payment mechanism blocked at the source (Aug 2026):**
      confirmed the real cause of duplicate Cash & Bank entries -
      recording a payment on a PI *after* it was already linked to an
      invoice created a fully independent second transaction, since the
      PI side had no idea the link existed. Now blocked outright (not
      just displayed differently) - marking a linked PI Paid/Partially
      Paid, or moving it to invoice a second time, is stopped with a
      message pointing to the real linked invoice. Includes
      `find_duplicate_payments.sql`, a read-only query to find every
      existing duplicate pair for manual cleanup via Cash & Bank's
      delete (which correctly reverses the balance). See "The actual
      duplicate-payment mechanism, blocked at the source" above for the
      full cleanup walkthrough.

- [x] **PI pending amount self-heals; Move to Invoice asks about payment
      directly (Aug 2026):** confirmed the real cause of a linked PI's
      Amount Pending staying stale forever after its invoice was paid -
      the two rows just never synced. Fixed as self-healing (reads the
      linked invoice's live paid amount every load, not a one-time
      correction), which also immediately fixes any PI already drifted,
      not just future ones. Move to Invoice gained its own "Payment
      already received" question, so a new payment can be recorded in the
      same step instead of a separate trip afterward. See "PI pending
      amount self-heals after its invoice is paid, and a real payment
      question in Move to Invoice" above.

- [x] **Move to Invoice (Aug 2026):** PI Follow-up → Actions → "Move to
      Invoice…" - a faster path to what Link to PI already did, creating
      the real sales_invoices record directly from the PI's row instead of
      needing a separate CSV import first. Type the real invoice number
      and date; amount and paid-so-far carry over automatically, with the
      same re-point-not-duplicate transaction handling Link to PI uses.
      See "Move to Invoice — a more direct alternative to Link to PI"
      above.

- [x] **Two real bugs fixed: stray Cash & Bank entries, Link to PI showing
      nothing (Aug 2026):** deleting a PI-linked payment transaction never
      reversed the PI's paid amount (the delete-with-reversal logic didn't
      know `related_proforma_invoice_id` existed) - fixed. Link to PI only
      ever matched an *exact* customer_id, silently showing nothing if the
      PI and Invoice exports produced two slightly different customer
      records for the same company - now searches every open PI in the
      firm with its own search box instead. See "Two real bugs: stray Cash
      & Bank entries, and Link to PI showing nothing" above.

- [x] **Marking Paid records a real payment; PI-to-Invoice linking (Aug
      2026):** picking Paid/Partially Paid anywhere now opens a real
      payment-recording flow (amount, bank account, date) instead of
      writing a decorative tag - a genuine `bank_transactions` row,
      updated account balance, and `paid_amount` bumped correctly. New
      "Link to PI" action on Sales carries a PI's payment over to the real
      imported invoice automatically, re-pointing (never duplicating) the
      existing transaction. See "Marking Paid now records a real payment,
      and PI-to-Invoice linking" above for the full detail.

- [x] **Real "All" default, Partially Paid, Cancelled routed correctly
      (Aug 2026):** Status filter default is now a genuine "All" (no more
      misleading "(default)" label), with the old pending-list behavior
      as its own explicit "Pending" option. Added "Partially Paid" as a
      real manual status. "Cancelled" in every status dropdown routes to
      the existing `is_cancelled` mechanism rather than creating a second,
      conflicting way to represent the same thing. `MANUAL_STATUSES`
      unified into one shared constant. See "A real 'All', Partially Paid,
      and Cancelled joining the status vocabulary" above for the full
      reasoning on each.

- [x] **Multi-line CSV import merge, +Add repositioned, password change
      restructured (Aug 2026):** the real bug behind "duplicate" errors on
      multi-line-item invoices/PIs (Zoho-style exports with one CSV row
      per line item) - now correctly merged into one document with a
      validated, summed total, instead of rejecting every row past the
      first. "+Add" moved from the left to the right side of the filter
      row. "Your password" restructured to live inside Firm details'
      header for Owners (matching that card's Edit-link pattern exactly),
      with a standalone fallback kept for non-Owners. See "Multi-line CSV
      import merge, +Add repositioned again, password change restructured"
      above.

- [x] **Change-password card collapsed, +Add moved into the filter row
      (Aug 2026):** "Your password" on Users & Permissions now matches
      Firm details exactly - collapsed by default, an "Edit" link reveals
      the form, same as everywhere else that pattern is used. The
      Customers/Suppliers "+ Add" button moved out of its own separate
      card and into the filter row itself, to the left of Search - also
      fixed once in the shared `FilterBar` component via a new optional
      `addAction` prop, so any future screen that needs the same pattern
      gets it for free.

- [x] **Forgot password, change password, Sales/Purchases cleanup (Aug
      2026):** "Forgot password?" on login (Supabase's own auth email, no
      new setup needed), a "Your password" change-password card on Users &
      Permissions, and the Customers/Suppliers heading removed with the
      add-new button simplified to "+ Add." See "Forgot password, change
      password, and a small cleanup on Sales/Purchases" above.

- [x] **Renamed "FinoPilo" to "FinoPilo Flow" (Aug 2026):** every
      user-facing occurrence updated the same way as the original Ledger
      OS → FinoPilo rebrand - sidebar, browser tab title, login/signup
      screens, invite emails, payment reminder emails, this README.
      **Important**: the three Edge Functions
      (`send-invite-email`/`send-payment-reminder`/
      `send-payment-reminders-batch`) need to be manually redeployed on
      Supabase for this to actually take effect in emails - that's exactly
      what caused the previous rename (Ledger OS → FinoPilo) to not show
      up in sent emails despite the code being correct. The main app
      redeploys automatically via GitHub → Cloudflare; Edge Functions do
      not, ever - each one needs its code pasted in and Deploy clicked by
      hand on Supabase's dashboard every time it changes.

- [x] **Rebranded from "Ledger OS" to "FinoPilo" (Aug 2026):** every
      user-facing occurrence updated - sidebar, browser tab title, login/
      signup screens (which also gained the "Your Financial Co-Pilot"
      tagline, previously showing no brand at all), invite emails, payment
      reminder emails, and this README. The General Ledger accounting
      module (Chart of Accounts/Journal Entries) keeps the name "Ledger" -
      that's a standard accounting term for that specific feature, not the
      app's old brand name, and was left alone deliberately. Note: the
      GitHub repo name and the Cloudflare deployment URL
      (`osbusiness.anuraj1996anu.workers.dev`) are unaffected by this -
      those are external to the codebase and need their own separate
      rename on GitHub/Cloudflare if wanted.

- [x] **Status-setting reverted to a plain dropdown + added to Receivables
      (Aug 2026):** the Actions-dropdown pill picker wasn't reliably
      working, so Status on Invoice/PI Follow-up is back to a direct,
      always-visible dropdown - the same proven pattern used everywhere
      else. Receivables' update-log drawer now has the same status-setting
      capability too (a "Tag" column on its Bills table) - both screens
      read the same underlying rows, so setting it from either one shows
      up on the other automatically, no sync needed. See "Status-setting
      reverted to a plain dropdown, and added to Receivables" above.

- [x] **Due Date column + Period repositioned (Aug 2026):** a Due Date
      column added between Amount Pending and Days Overdue on both
      Follow-up screens, and Period moved to sit right after Status in the
      shared `FilterBar` component - applying to every screen with a
      Status filter at once.

- [x] **PI/Invoice double-counting fix, Cancel extended, DSO period filter,
      global period-selector redesign (Aug 2026):** fixed the real bug
      behind "PI not fetching in Receivables" (the update-drawer only ever
      read Sales Invoices) and the real bug behind "PI not moving to
      Invoice" (marking a PI "Invoiced" was cosmetic and didn't stop it
      double-counting once the real Tax Invoice was also imported) via a
      new shared `isResolved()` rule applied consistently everywhere a
      pending total exists. Cancel extended from Purchase-Bills-only to
      Sales Invoices and Proforma Invoices too. DSO & Trends got a period
      filter. The shared `PeriodSelector` component was redesigned from
      pill buttons to a dropdown, applying to every screen that uses it at
      once. See "Real bugs found and fixed" above for the full detail on
      each.

- [x] **DSO & Collection Trends (Aug 2026):** new AR/AP tab - a real,
      correctly-computed current DSO snapshot, plus a 12-month cohort trend
      (avg days to collect, collection rate) computed from data that
      actually exists, since true historical DSO can't be reconstructed
      without daily AR balances this app never recorded. Coverage gaps
      (invoices paid without a linked transaction) are shown directly in
      the UI, not hidden. See "DSO & Collection Trends" above for the full
      methodology and honest limitations.

- [x] **Row click consistency on Follow-up screens (Aug 2026):** clicking a
      row on Invoice/PI Follow-up now opens the Log-an-update drawer,
      matching Receivables/Payables, instead of the reminder-email panel.
      Managing reminder emails moved to an explicit Actions dropdown
      option. See "Row click on Invoice/PI Follow-up now matches
      Receivables/Payables" above.

- [x] **Bill cancellation, Payables parity, deeper hyperlinks, send-reminder
      confirmation (Aug 2026):** Purchases got a real Cancel/Reinstate bill
      action (excluded from Payables entirely while cancelled). Payables
      finally has the same update-log drawer Receivables has, via a new
      `supplier_comms` table. Sales/Purchases rows got the same
      "Actions..." dropdown pattern, adding direct jumps to Receivables/
      Payables/Invoice Follow-up/PI Follow-up. "Send reminder now" shows
      the destination email and requires an explicit confirm before
      sending, instead of firing blind. See "Bill cancellation, Payables
      parity, deeper hyperlinks, send-reminder confirmation" above for
      full detail.

- [x] **Cross-screen navigation (Aug 2026):** customer/supplier names in
      Sales/Purchases are now clickable, jumping to Receivables/Payables
      pre-filtered to that exact one. Receivables' row action is now an
      "Actions..." dropdown (View details / Invoice Follow-up → / PI
      Follow-up →), matching the Follow-up screens' style, with the same
      two jump-links added to the update-log drawer itself. Payables
      deliberately didn't get an Actions dropdown - no communication-log
      data model exists for suppliers yet, so there's nothing to open. See
      "Cross-screen navigation" above for the full detail and the honest
      reasoning on that asymmetry.

- [x] **Itemized tax breakdown + manual status + Follow-up upgrades (Aug
      2026):** optional item/tax fields (description, qty, rate, subtotal,
      discount, CGST/SGST/IGST) importable per document, rendering a real
      itemized+tax PDF breakdown when present. Added a manual workflow
      status (Sent/Overdue/Paid/Invoiced/Completed) as both a filter and a
      per-row setting on Invoice/PI Follow-up, plus stat cards, an Actions
      dropdown replacing three crowded buttons, and "Log an update"
      (previously missing from these two screens). See "Itemized tax
      breakdown + manual workflow status + Follow-up screen upgrades"
      above for full detail.

- [x] **Receivables now includes PI + Preview on Follow-up screens (Aug
      2026):** Receivables' stat cards and pending-clients list were
      silently only reflecting Sales Invoices - now combine Invoice + PI
      pending amounts (with a plain-language note when a granular status
      filter can't include PI). Added PDF Preview to Invoice/PI Follow-up,
      matching what Sales/Purchases already had. See "Receivables now
      includes Proforma Invoices, and Preview added to Follow-up" above.

- [x] **Proforma Invoices + Payment Reminders (Aug 2026):** PI tracked
      side by side with Tax Invoices (imported, never generated/converted
      in-app), two new AR/AP tabs (Invoice Follow-up / PI Follow-up) with
      per-document days-overdue and reminder status, per-customer
      reminder email lists, Pause/Resume, and a manual "Send now" that
      works today. Automatic daily sending needs a one-time Supabase Cron
      Job setup - see "Proforma Invoices + Payment Reminders" above for
      the full walkthrough, including deploying the two new Edge
      Functions this needs. WhatsApp/SMS reminders deliberately not built
      yet - each needs its own provider account and approval process.

- [x] **Fixed PDF text overlapping itself on long addresses (Aug 2026):**
      the actual bug behind the garbled-looking header on generated
      invoice/bill PDFs — a long firm or customer address wraps onto two
      lines, but the code only ever advanced past it by a fixed one-line
      amount, so the next field (GSTIN, in the reported case) got drawn
      directly on top of the wrapped second line instead of below it.
      Fixed properly using jsPDF's actual wrapped-line count rather than
      assuming everything is always one line — same fix applied to the
      firm header, the Bill To/Vendor block, quotation line-item
      descriptions, and credit/debit note reasons, since all four had the
      identical root cause.

- [x] **PDF preview for Sales/Purchases (Aug 2026):** the PDF action on
      invoices/bills now opens a Preview modal showing the actual generated
      PDF inline (a real `blob:` URL in the browser's own PDF viewer, not
      an HTML approximation), with Download available from inside it.
      `lib/pdf.js`'s generators were split into build/download/preview so
      every document type could get this the same way. See "PDF preview
      (Sales & Purchases)" above for full detail.
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
- [x] **Reports polish (Aug 2026):** Balance Sheet (Assets | Liabilities+
      Equity) and Profit & Loss (Income | Expenses) now lay out side by
      side on desktop instead of stacked top-to-bottom (collapses back to
      one column under 860px, same responsive breakpoint used everywhere
      else). All three reports got real period controls matching the rest
      of the app's look: Profit & Loss gets This/Previous Fiscal Year,
      Last 12 Months, All Time, and Custom (date range); Trial Balance and
      Balance Sheet get Today, End of Last Month, End of Previous FY, and
      Custom (single as-of date) - the correct shape for a snapshot report
      vs. a period report. Every control is fully reactive: picking a
      preset or typing a custom date updates the report immediately from
      data already in memory, no fetch/apply button anywhere.
- [x] **General Ledger, phase 1 of the Prototype Review recommendations
      (Aug 2026):** Chart of Accounts, Journal Entries with a draft→posted
      approval step, and Trial Balance / P&L / Balance Sheet reports - a
      real double-entry ledger, gated behind its own permission. See
      "General Ledger" above for full scope and honest limitations
      (no auto-posting from Sales/Purchases/Cash & Bank yet, no draft-line
      editing, no GST awareness yet - each is its own future phase).
- [x] **Real invite acceptance flow, token-based (Aug 2026):** every
      invite now gets its own unique link leading to a dedicated "Join
      {firm}" page (firm name, who invited you, your role, a password
      field locked to that one email) - modeled directly on how Zoho and
      similar products handle this, instead of the invite link just
      pointing at the app's plain homepage. See "Real invite acceptance
      flow" above for full detail, including how it handles being already
      signed in, declining, and invalid/reused links.
- [x] **Fixed invited teammates ending up as Owner of a new firm (Aug
      2026):** signup now auto-detects a pending invite for the email used
      and joins that existing firm instead of always creating a new one -
      also fixed a real RLS catch-22 in the invite-linking check itself
      (couldn't see the very row it needed to find), via a new
      `security definer` function. See "Fixed: invited teammates ending
      up as Owner of a new firm" above for the full detail.
- [x] **Polish: placeholders, Import UI, real logo upload (Aug 2026):**
      fixed hardcoded "Anuraj"/"NyooKart Apparel" placeholders on both
      signup screens (a real bug for anyone else using this), converted
      Import Data's type selector to match the app's filter-bar dropdown
      style, and replaced the logo URL text field with a real PNG/JPEG/JPG
      upload to a new Supabase Storage bucket. See "Polish: placeholders,
      Import UI, real logo upload" above for full detail.
- [x] **Export as Excel/PDF/Word + real PDF fix (Aug 2026):** found and
      fixed the actual cause of "Export PDF does nothing" (a dynamic
      import creating a gap between click and file save that some browsers
      silently drop) by making jsPDF a static import - real bundle-size
      cost, but the feature now reliably works. Added Word export (`docx`
      library, checked clean). Replaced the separate Export CSV/PDF buttons
      with one "Export as" action-dropdown in the shared filter row, next
      to Sort by, on every screen that has one. See "Export as: Excel /
      PDF / Word" above for the full detail and the bundle-size tradeoff.
- [x] **Payment dates + CSV/PDF exports (Aug 2026):** Record Payment/Record
      Refund now ask for the actual date the money moved, instead of
      silently always using today. Added Export CSV/PDF to Cash & Bank
      transactions and to Receivables/Payables, Sales, Purchases,
      Quotations, and Credit/Debit Notes, respecting whatever's currently
      filtered. Receivables/Payables' Status filter now includes "Paid"
      alongside the open statuses, turning the same table into a paid view
      rather than needing a separate report (an earlier version added a
      separate "Payments Received"/"Payments Made" table for this - folded
      into one unified status filter instead, since that's simpler). See
      "Payment dates + CSV/PDF exports" above for the full detail and the
      CSV-vs-.xlsx reasoning.
- [x] **Cash & Bank corrections (Aug 2026):** fixed a real correctness gap
      where editing an existing invoice/bill's paid amount silently
      desynced from Cash & Bank ("Record Payment" was the only path that
      ever updated the account balance). "Already paid" is now read-only
      once a record exists - use Record Payment, or delete the matching
      transaction below to fully reverse it. Added a Delete button on Cash
      & Bank transactions that properly reverses the account balance and
      the linked invoice/bill/note, not just the row. See "Cash & Bank
      corrections" above for full detail and a known limitation for
      transactions created before this migration.
- [x] **Import duplicate detection + sortable headers (Aug 2026):**
      importing no longer creates duplicate invoices/bills/parties - every
      row is checked against your existing records and against the rest of
      the file before import, with duplicates clearly flagged and skipped.
      Also added click-to-sort column headers (with an arrow indicator) on
      Sales, Purchases, Quotations, Credit/Debit Notes, and the "Amount
      due" column on Receivables/Payables - same underlying sort state the
      FilterBar dropdown already used, just a second, more standard way to
      trigger it.
- [x] **Scope refocus + CSV Import (Aug 2026):** app refocused to AR/AP
      collections - Quotations/Notes/Ledger hidden from nav (not deleted,
      fully reversible, see "Scope: AR/AP focus" above). Added CSV bulk
      import for Customers/Suppliers/Sales Invoices/Purchase Bills, with
      column mapping, per-row validation, auto-created parties, and a real
      Undo per import batch. Deliberately CSV-only, not Excel - see
      "Import Data" above for the vulnerable-dependency reasoning.
- [ ] Live sync with Zoho Books (OAuth2, no manual export needed) is a
      natural next step now that file-based import exists — bigger build,
      needs a Zoho Developer Console app registered on your end first,
      same category of one-time setup as the Resend email integration.
- [ ] Tally has no live-sync path at all from a cloud-hosted app — it only
      talks to its own local network (ODBC / XML-HTTP gateway on
      localhost). A real "live" Tally integration would need a small
      agent/script installed on the same machine/network as Tally, which
      is a different kind of project from anything else in this app.
- [x] **Credit / Debit Notes, phase 2 continued (Aug 2026):** independent
      correction/refund records for Sales and Purchases, each with their
      own auto-numbering, PDF export, and real Cash & Bank money movement
      on refund. See "Credit / Debit Notes" above for the full scope and
      the money-direction reasoning.
- [x] **Quotations, phase 2 of the Prototype Review recommendations (Aug
      2026):** itemized Draft→Sent→Accepted/Declined quotes with real line
      items, auto-numbering, PDF export, and one-click Convert to Invoice.
      See "Quotations" above for exact scope and the itemization handoff.
- [ ] Editing a quote replaces all its line items rather than diffing them
      (delete-all-then-reinsert on save) - fine for typical quote sizes,
      but means line item `id`s change on every edit, so nothing external
      should reference a specific line item's id long-term.
- [x] **Branding, invoice numbering, and PDF export (Aug 2026):** firm
      address/phone/email/logo/payment-instructions, atomic per-firm
      invoice numbering for sales invoices, and a one-click branded PDF
      download for every invoice/bill. See "Branding, invoice numbering,
      and PDFs" above for exact scope and the itemization limitation.
- [ ] Logo is a pasted URL, not an upload — needs a Supabase Storage
      bucket + RLS policies to support real file uploads, not done yet.
- [ ] RLS lets any active member send an invite, remove a member, or write
      to the Chart of Accounts, not just Owners/people with the Ledger
      permission (UI hides these actions appropriately, but the API itself
      doesn't enforce it yet)

