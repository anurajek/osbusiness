-- ============================================================================
-- Migration: Fix unprotected foreign keys blocking Sales Invoice deletion
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- The actual root cause of "some data removed, Sales still showing the
-- data" after using Import Data's Undo: credit_notes.original_invoice_id
-- and quotations.converted_invoice_id both reference sales_invoices(id)
-- with no ON DELETE behavior specified at all - Postgres defaults that to
-- NO ACTION, which silently blocks deleting a sales_invoice row if any
-- credit note or quotation still references it.
--
-- Written defensively - credit_notes/quotations are both hidden features,
-- and either or both may never have actually been created on a given
-- database (confirmed directly: "relation quotations does not exist" on
-- a real attempt to run the unconditional version of this migration).
-- Each block below only runs if that specific table genuinely exists, so
-- this is safe to run regardless of which hidden features were ever set
-- up on this particular database.
--
-- Fixed with ON DELETE SET NULL, not CASCADE: if the invoice it pointed to
-- is gone, the credit note or quotation itself should still exist (it's
-- real history) - it just loses that one reference rather than being
-- deleted along with the invoice.
-- ============================================================================

do $$
begin
  if to_regclass('public.credit_notes') is not null then
    alter table credit_notes drop constraint if exists credit_notes_original_invoice_id_fkey;
    alter table credit_notes add constraint credit_notes_original_invoice_id_fkey
      foreign key (original_invoice_id) references sales_invoices(id) on delete set null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.quotations') is not null then
    alter table quotations drop constraint if exists quotations_converted_invoice_id_fkey;
    alter table quotations add constraint quotations_converted_invoice_id_fkey
      foreign key (converted_invoice_id) references sales_invoices(id) on delete set null;
  end if;
end $$;
