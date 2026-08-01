-- ============================================================================
-- Migration: Branding + Invoice Numbering
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Adds what a branded, professional invoice PDF actually needs:
--   - firms: address/phone/email/logo_url/bank_details for the document
--     header/footer, plus invoice_prefix/next_invoice_number for real
--     sequential numbering (e.g. INV-0001, INV-0002, ...) instead of
--     whatever text someone happens to type into the box.
--   - customers/suppliers: address + email, so a "Bill To" block has
--     somewhere to pull an address from, and a future "email this invoice"
--     feature has somewhere to send to.
-- All new columns are nullable with sane defaults - nothing existing breaks,
-- and every firm/customer/supplier that already exists just has these as
-- empty until someone fills them in.
-- ============================================================================

alter table firms add column if not exists address text;
alter table firms add column if not exists phone text;
alter table firms add column if not exists email text;
alter table firms add column if not exists logo_url text;
alter table firms add column if not exists bank_details text;
alter table firms add column if not exists invoice_prefix text not null default 'INV-';
alter table firms add column if not exists next_invoice_number integer not null default 1;

alter table customers add column if not exists address text;
alter table customers add column if not exists email text;
alter table suppliers add column if not exists address text;
alter table suppliers add column if not exists email text;

-- ----------------------------------------------------------------------------
-- next_sales_invoice_number: atomically reserves and returns the next
-- number for a firm's sales invoices (e.g. "INV-0007"), formatted with the
-- firm's own prefix and zero-padded to 4 digits. The UPDATE...RETURNING is
-- what makes this safe against two people creating an invoice at the same
-- moment - Postgres row-locking on the UPDATE serializes concurrent calls,
-- so nobody can ever get handed the same number twice.
--
-- Only used for sales invoices, deliberately - purchase bills carry
-- whatever number the vendor gave them, not one we assign.
-- ----------------------------------------------------------------------------
create or replace function next_sales_invoice_number(p_firm_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number integer;
begin
  if not is_firm_member(p_firm_id) then
    raise exception 'Not a member of this firm.';
  end if;

  update firms
    set next_invoice_number = next_invoice_number + 1
    where id = p_firm_id
    returning invoice_prefix, next_invoice_number - 1
    into v_prefix, v_number;

  if v_number is null then
    raise exception 'Firm not found.';
  end if;

  return v_prefix || lpad(v_number::text, 4, '0');
end;
$$;

grant execute on function next_sales_invoice_number(uuid) to authenticated;
