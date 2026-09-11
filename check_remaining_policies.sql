select tablename, policyname, cmd, qual
from pg_policies
where tablename in ('firms', 'firm_members', 'bank_transactions', 'customers', 'purchase_bills', 'sales_invoices', 'suppliers')
order by tablename, cmd;
