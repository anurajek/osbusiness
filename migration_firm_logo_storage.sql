-- ============================================================================
-- Migration: Firm Logo Storage
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Adds a public Storage bucket for firm logos, so "Logo" on Users &
-- Permissions can be a real file upload (PNG/JPG/JPEG) instead of pasting
-- a URL to an image hosted somewhere else. The bucket is public (readable
-- by anyone with the link, no auth needed) since logos are already shown
-- in places that need a plain URL with no auth context - invoice/quote/
-- note PDFs generated in the browser, and the app's own topbar - exactly
-- the same trust level the old "paste any public URL" approach already had.
--
-- Files are stored at `{firm_id}/logo.{ext}` - the RLS policies below use
-- that first path segment (via storage.foldername()) to check firm
-- membership, so a firm's members can only upload/replace/remove their
-- own firm's logo, never another firm's.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('firm-logos', 'firm-logos', true)
on conflict (id) do nothing;

create policy "anyone can view firm logos" on storage.objects
  for select using (bucket_id = 'firm-logos');

create policy "firm members can upload their firm's logo" on storage.objects
  for insert with check (
    bucket_id = 'firm-logos'
    and is_firm_member((storage.foldername(name))[1]::uuid)
  );

create policy "firm members can replace their firm's logo" on storage.objects
  for update using (
    bucket_id = 'firm-logos'
    and is_firm_member((storage.foldername(name))[1]::uuid)
  );

create policy "firm members can remove their firm's logo" on storage.objects
  for delete using (
    bucket_id = 'firm-logos'
    and is_firm_member((storage.foldername(name))[1]::uuid)
  );
