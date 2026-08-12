-- Finds every PI-linked-to-invoice pair where BOTH sides ended up with
-- their own separate bank_transaction - meaning the PI's transaction was
-- never re-pointed to the invoice, and the same payment got counted twice
-- in Cash & Bank. Read-only - identifies the pairs, doesn't delete anything.
select
  pi.pi_no,
  inv.invoice_no,
  pi_txn.id            as pi_side_transaction_id_to_delete,
  pi_txn.amount        as pi_side_amount,
  pi_txn.txn_date      as pi_side_date,
  inv_txn.id            as invoice_side_transaction_id_to_keep,
  inv_txn.amount        as invoice_side_amount,
  inv_txn.txn_date      as invoice_side_date
from proforma_invoices pi
join sales_invoices inv on inv.linked_pi_id = pi.id
join bank_transactions pi_txn on pi_txn.related_proforma_invoice_id = pi.id
join bank_transactions inv_txn on inv_txn.related_sales_invoice_id = inv.id
order by pi.pi_no;
