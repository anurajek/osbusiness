-- Finds any invoice/PI where its linked bank transactions sum to MORE than
-- the document's own recorded amount - a strong signal of a duplicate
-- payment, regardless of exactly which columns caused it (unlike a query
-- tied to one specific FK pattern, this catches every shape a duplicate
-- could take). Read-only - identifies problems, doesn't delete anything.

select 'Sales Invoice' as doc_type, si.invoice_no as doc_number, si.amount as doc_amount,
       si.paid_amount as doc_paid_amount, sum(bt.amount) as transactions_total,
       count(bt.id) as transaction_count
from sales_invoices si
join bank_transactions bt on bt.related_sales_invoice_id = si.id
group by si.id, si.invoice_no, si.amount, si.paid_amount
having sum(bt.amount) > si.amount

union all

select 'Proforma Invoice' as doc_type, pi.pi_no as doc_number, pi.amount as doc_amount,
       pi.paid_amount as doc_paid_amount, sum(bt.amount) as transactions_total,
       count(bt.id) as transaction_count
from proforma_invoices pi
join bank_transactions bt on bt.related_proforma_invoice_id = pi.id
group by pi.id, pi.pi_no, pi.amount, pi.paid_amount
having sum(bt.amount) > pi.amount

order by doc_number;
