select tablename, policyname, cmd, with_check
from pg_policies
where (tablename = 'firms' and policyname = 'any authenticated user can create a firm')
   or (tablename = 'firm_members' and policyname = 'insert own membership or invite a teammate');
