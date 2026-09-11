-- ============================================================================
-- Migration: Notifications - assignment alerts + a home for Recent Activity
-- Run this in Supabase's SQL Editor. Additive/safe on the existing database.
--
-- Two things this adds:
-- 1. A notifications table + a trigger (not application code) that fires
--    whenever assigned_to_ids gains a new member, on any of the four
--    places assignment happens - ar_comms/supplier_comms (comm-log tasks)
--    and sales_invoices/proforma_invoices (document-level assign). Doing
--    this as a database trigger rather than adding "and also insert a
--    notification" to every screen's addComm/handleSaveAssign/handleAddPi
--    means it can't be missed by a future assign path that forgets to
--    call it - there's exactly one place this logic lives.
-- 2. Nothing new for Recent Activity itself - the existing activity_log
--    table is untouched. The Dashboard's card reading it just moves into
--    the new NotificationBell dropdown instead (see ui.jsx/AppShell.jsx).
--
-- Notifications are trigger-only by design - there is deliberately no
-- INSERT policy for `authenticated` on this table, so a client can never
-- write an arbitrary notification claiming to be from someone else. Only
-- the SECURITY DEFINER trigger function can insert; a member can only
-- read and mark-read their own.
-- ============================================================================

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  member_id uuid not null references firm_members(id) on delete cascade,
  kind text not null default 'task_assigned',
  message text not null,
  party_kind text,
  party_id uuid,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_member_unread_idx on notifications (member_id, read, created_at desc);

alter table notifications enable row level security;

drop policy if exists "members can view their own notifications" on notifications;
create policy "members can view their own notifications" on notifications
  for select using (member_id in (select id from firm_members where user_id = (select auth.uid())));

drop policy if exists "members can mark their own notifications read" on notifications;
create policy "members can mark their own notifications read" on notifications
  for update using (member_id in (select id from firm_members where user_id = (select auth.uid())));

-- One shared trigger function, reused on all four tables - TG_TABLE_NAME
-- tells it which one fired, so the message/navigation target is built
-- appropriately either way.
create or replace function notify_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ids uuid[] := coalesce(NEW.assigned_to_ids, '{}');
  old_ids uuid[] := case when TG_OP = 'UPDATE' then coalesce(OLD.assigned_to_ids, '{}') else '{}'::uuid[] end;
  added_ids uuid[];
  actor_member_id uuid;
  actor_name text;
  msg text;
  p_kind text;
  p_party_id uuid;
begin
  select array_agg(id) into added_ids from unnest(new_ids) as id where id <> all(old_ids);
  if added_ids is null or array_length(added_ids, 1) is null then
    return NEW;
  end if;

  select fm.id, fm.full_name into actor_member_id, actor_name
  from firm_members fm
  where fm.user_id = auth.uid() and fm.firm_id = NEW.firm_id
  limit 1;

  if TG_TABLE_NAME = 'ar_comms' then
    msg := coalesce(actor_name, 'Someone') || ' assigned you a task: ' || left(coalesce(NEW.note, ''), 80);
    p_kind := 'ar'; p_party_id := NEW.customer_id;
  elsif TG_TABLE_NAME = 'supplier_comms' then
    msg := coalesce(actor_name, 'Someone') || ' assigned you a task: ' || left(coalesce(NEW.note, ''), 80);
    p_kind := 'ap'; p_party_id := NEW.supplier_id;
  elsif TG_TABLE_NAME = 'sales_invoices' then
    msg := coalesce(actor_name, 'Someone') || ' assigned you to Invoice ' || NEW.invoice_no;
    p_kind := 'ar'; p_party_id := NEW.customer_id;
  elsif TG_TABLE_NAME = 'proforma_invoices' then
    msg := coalesce(actor_name, 'Someone') || ' assigned you to PI ' || NEW.pi_no;
    p_kind := 'ar'; p_party_id := NEW.customer_id;
  end if;

  insert into notifications (firm_id, member_id, kind, message, party_kind, party_id)
  select NEW.firm_id, uid, 'task_assigned', msg, p_kind, p_party_id
  from unnest(added_ids) as uid
  where uid is distinct from actor_member_id; -- never notify yourself for your own assignment

  return NEW;
end;
$$;

drop trigger if exists trg_notify_ar_comms_assign on ar_comms;
create trigger trg_notify_ar_comms_assign
  after insert or update of assigned_to_ids on ar_comms
  for each row execute function notify_on_assignment();

drop trigger if exists trg_notify_supplier_comms_assign on supplier_comms;
create trigger trg_notify_supplier_comms_assign
  after insert or update of assigned_to_ids on supplier_comms
  for each row execute function notify_on_assignment();

drop trigger if exists trg_notify_sales_invoices_assign on sales_invoices;
create trigger trg_notify_sales_invoices_assign
  after insert or update of assigned_to_ids on sales_invoices
  for each row execute function notify_on_assignment();

drop trigger if exists trg_notify_proforma_invoices_assign on proforma_invoices;
create trigger trg_notify_proforma_invoices_assign
  after insert or update of assigned_to_ids on proforma_invoices
  for each row execute function notify_on_assignment();
