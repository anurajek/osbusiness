select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_name like 'trg_notify_%'
order by event_object_table;
