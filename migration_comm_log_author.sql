-- ============================================================================
-- Migration: Who logged each comm-log entry
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- ar_comms/supplier_comms had no record of who actually wrote a given
-- update - only who it's assigned to (assigned_to_ids) and who's
-- @mentioned in the text. Adds created_by, set automatically to whoever's
-- logged in at the moment they save an update (the app sets it, there's
-- no UI to pick someone else) - shown in the Communication Timeline
-- alongside the existing "Assigned to" and mention info.
--
-- References firm_members(id), same as assigned_to_ids/mentioned_member_ids,
-- for consistency with the rest of this feature - not auth.users(id) (the
-- pattern journal_entries/import_batches use), since everywhere else this
-- feature already resolves member names through the firm_members list
-- already being fetched for Assign/mentions.
-- ============================================================================

alter table ar_comms add column if not exists created_by uuid references firm_members(id) on delete set null;
alter table supplier_comms add column if not exists created_by uuid references firm_members(id) on delete set null;
