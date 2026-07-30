# Ledger OS

Multi-tenant accounting CRM — cashflow forecasting, sales, purchases, AR/AP, and cash & bank, built for firms managing multiple client books.

## Stack
- React + Vite
- Tailwind CSS v4
- Supabase (Postgres + Auth + Row Level Security)

## Setup

1. Install dependencies: 
   ```
   npm install
   ```

2. Copy the environment template and fill in your real Supabase project values
   (found in Supabase Dashboard → Settings → API):
   ```
   cp .env.example .env
   ```

3. Make sure you've already run `ledger_os_schema.sql` in your Supabase project's
   SQL Editor, and that Email auth is enabled under Authentication → Providers.

4. Run locally:
   ```
   npm run dev
   ```

5. Sign in with a user that has a matching row in `firm_members`. If you haven't
   created one yet:
   - Sign up a user via the app's login screen (or Supabase Dashboard → Authentication)
   - In SQL Editor, insert a firm and link that user to it:
     ```sql
     insert into firms (name, gstin) values ('Your Firm Name', 'GSTIN_HERE');

     insert into firm_members (firm_id, user_id, full_name, role)
     values ('<firm-id-from-above>', '<auth-user-id>', 'Your Name', 'Owner');
     ```

## Status

- [x] Project scaffold (Vite + React + Tailwind)
- [x] Supabase client configured
- [x] Real login screen (Supabase Auth, email + password)
- [ ] Dashboard, Sales, Purchases, Receivables, Payables, Cash & Bank wired to real data
- [ ] Users & Permissions screen wired to `firm_members`
