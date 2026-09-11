-- 1. Does the trigger actually exist on all four tables?
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_name like 'trg_notify_%'
order by event_object_table;

-- 2. Has the trigger ever actually created a notification row? (SQL Editor
-- runs as postgres, so this bypasses RLS - shows everything regardless of
-- who'd be allowed to see it from the app)
select id, firm_id, member_id, message, read, created_at
from notifications
order by created_at desc
limit 20;

-- 3. Spot check a few recent assignments - did assigned_to_ids actually
-- save the way it should have?
select id, assigned_to_ids, created_at from ar_comms order by created_at desc limit 5;
