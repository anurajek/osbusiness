select id, firm_id, member_id, message, read, created_at
from notifications
order by created_at desc
limit 20;
