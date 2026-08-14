import { useCallback, useEffect, useState, Fragment } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, toISODate, getPeriodRange, isResolved, balanceDue, MANUAL_STATUSES } from '../lib/format'
import { FilterBar } from '../components/FilterControls'
import { SectionHeader, EmptyRow, StatCard } from '../components/ui'
import CommDrawer from '../components/CommDrawer'
import { downloadCsv } from '../lib/exportCsv'
import { downloadListPdf, previewDocumentPdf, itemTaxFieldsFromRow } from '../lib/pdf'
import { downloadListDocx } from '../lib/exportDocx'
import PdfPreviewModal from '../components/PdfPreviewModal'

const STAGE_LABEL = { gentle: 'Gentle nudge', reminder: 'Reminder', due: 'Due notice', overdue: 'Overdue notice' }

export default function PaymentFollowUpScreen({ docType, navParams, clearNavParams }) {
  const { firmId, firm, role } = useFirm()
  const isPi = docType === 'pi'
  const table = isPi ? 'proforma_invoices' : 'sales_invoices'
  const numberField = isPi ? 'pi_no' : 'invoice_no'
  const docLabel = isPi ? 'Proforma Invoice' : 'Invoice'
  const graceDays = firm?.reminder_grace_days ?? 7

  const [docs, setDocs] = useState([])
  const [customers, setCustomers] = useState([])
  const [comms, setComms] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const [period, setPeriod] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('overdue-desc')
  const [statusFilter, setStatusFilter] = useState('all')

  const [expandedId, setExpandedId] = useState(null)
  const [sendConfirmId, setSendConfirmId] = useState(null)
  const [emailsByCustomer, setEmailsByCustomer] = useState({})
  const [newEmail, setNewEmail] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [actionMsg, setActionMsg] = useState({})
  const [preview, setPreview] = useState(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)

  // Payment-recording form, opened when the Status dropdown is set to Paid
  // or Partially Paid - both mean "money actually arrived," so both need a
  // real amount and a real bank account, not just a text tag. payTargetStatus
  // tracks which of the two was picked, since that's what gets written to
  // manual_status once the payment itself is successfully recorded.
  const [payingRowId, setPayingRowId] = useState(null)
  const [payTargetStatus, setPayTargetStatus] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payAccountId, setPayAccountId] = useState('')
  const [payDate, setPayDate] = useState('')
  const [payError, setPayError] = useState(null)
  const [payingBusy, setPayingBusy] = useState(false)

  // PI-only: creates the real sales_invoices record directly from this PI
  // (you type the actual invoice number/date - this tool still never
  // auto-generates those, it's just one step instead of a separate CSV
  // import + Link to PI). Whatever the PI's paid_amount already is gets
  // carried over untouched, and any bank_transaction tied to the PI is
  // re-pointed to the new invoice rather than duplicated. Optionally, a
  // genuinely new payment can be recorded in this same step (separate
  // from whatever was already carried over) - a real question, not an
  // automatic assumption, since whether payment happened before or after
  // the real invoice existed varies case to case.
  const [convertingRowId, setConvertingRowId] = useState(null)
  const [convertInvoiceNo, setConvertInvoiceNo] = useState('')
  const [convertDate, setConvertDate] = useState('')
  const [convertPaymentReceived, setConvertPaymentReceived] = useState(false)
  const [convertPayAmount, setConvertPayAmount] = useState('')
  const [convertPayAccountId, setConvertPayAccountId] = useState('')
  const [convertPayDate, setConvertPayDate] = useState('')
  const [convertError, setConvertError] = useState(null)
  const [convertingBusy, setConvertingBusy] = useState(false)

  const load = useCallback(async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const [{ data: docRows, error: docErr }, { data: custs, error: custErr }, { data: commRows, error: commErr }, { data: acctRows, error: acctErr }, { data: linkedRows, error: linkedErr }] = await Promise.all([
      supabase.from(table)
        .select(`id, customer_id, ${numberField}, issued_date, amount, paid_amount, reminders_paused, last_reminder_stage, last_reminder_sent_date, manual_status, is_cancelled, item_description, item_quantity, item_rate, subtotal, discount_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount`)
        .eq('firm_id', firmId).order('issued_date', { ascending: false }),
      supabase.from('customers').select('id, name, email, address, gstin').eq('firm_id', firmId),
      supabase.from('ar_comms').select('id, customer_id, channel, tag, note, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }),
      supabase.from('bank_accounts').select('id, name, balance').eq('firm_id', firmId).order('name'),
      // Once a PI is linked to an invoice (Move to Invoice / Link to PI),
      // the PI's own paid_amount is a one-time snapshot from that moment -
      // nothing updates it again when the invoice is later paid, since
      // they're two separate rows. Rather than trying to keep them in
      // sync on every possible payment-recording code path (fragile, easy
      // to miss one), this reads the linked invoice's CURRENT paid_amount
      // fresh every load and uses it in place of the PI's own frozen
      // value below - self-healing, and it fixes an already-drifted PI
      // immediately with no backfill needed.
      isPi ? supabase.from('sales_invoices').select('id, invoice_no, paid_amount, linked_pi_id').eq('firm_id', firmId).not('linked_pi_id', 'is', null) : Promise.resolve({ data: [], error: null }),
    ])
    if (docErr || custErr || commErr || acctErr || linkedErr) { setError((docErr || custErr || commErr || acctErr || linkedErr).message); setLoading(false); return }

    const linkedInvoiceByPiId = new Map((linkedRows ?? []).map((inv) => [inv.linked_pi_id, inv]))
    const effectiveDocs = (docRows ?? []).map((d) => {
      const linked = linkedInvoiceByPiId.get(d.id)
      return linked ? { ...d, paid_amount: Number(linked.paid_amount), linkedToInvoice: true, linkedInvoiceId: linked.id, linkedInvoiceNo: linked.invoice_no } : d
    })

    setDocs(effectiveDocs)
    setCustomers(custs ?? [])
    setComms(commRows ?? [])
    setBankAccounts(acctRows ?? [])
    setLoading(false)
  }, [firmId, table, numberField, isPi])

  useEffect(() => { load() }, [load])


  // Arriving here from a click elsewhere (e.g. "Invoice Follow-up ->" in
  // Receivables' update drawer) pre-filters to that one customer. This
  // screen's only filter is the name search box, so that's what gets set -
  // waits for customers to actually be loaded before looking the name up.
  useEffect(() => {
    if (navParams?.customerId && customers.length > 0) {
      const match = customers.find((c) => c.id === navParams.customerId)
      if (match) setSearch(match.name)
      clearNavParams?.()
    }
  }, [navParams, customers, clearNavParams])

  const customerName = (id) => customers.find((c) => c.id === id)?.name || '—'
  const daysSinceIssued = (issuedDate) => Math.floor((Date.now() - new Date(issuedDate + 'T00:00:00').getTime()) / 86400000)
  const daysOverdue = (issuedDate) => Math.max(0, daysSinceIssued(issuedDate) - graceDays)

  const range = getPeriodRange(period, customFrom, customTo)

  const docsInPeriod = range
    ? docs.filter((d) => { const dt = new Date(d.issued_date); return dt >= range.from && dt <= range.to })
    : docs

  const activeDocsInPeriod = docsInPeriod.filter((d) => !d.is_cancelled)

  const totals = activeDocsInPeriod.reduce((acc, d) => {
    acc.invoiced += Number(d.amount)
    acc.collected += Number(d.paid_amount || 0)
    return acc
  }, { invoiced: 0, collected: 0 })
  totals.pending = activeDocsInPeriod.filter((d) => !isResolved(d)).reduce((s, d) => s + (Number(d.amount) - Number(d.paid_amount || 0)), 0)

  const pending = activeDocsInPeriod.filter((d) => !isResolved(d))

  // "All" now means what it says - every document in the period,
  // cancelled and resolved ones included, using docsInPeriod directly
  // rather than the cancelled-excluded activeDocsInPeriod. "Pending" is
  // the old default behavior (amount-based, actionable, most common case)
  // under its own explicit name rather than living inside "all." A
  // specific manual status searches the whole active period, since a
  // document tagged "Paid" or "Completed" may well have already dropped
  // out of the pending set. "Cancelled" reads is_cancelled directly,
  // not manual_status - see lib/format.js's comment on MANUAL_STATUSES
  // for why those are kept as two different, non-overlapping mechanisms.
  const baseRows =
    statusFilter === 'all' ? docsInPeriod
    : statusFilter === 'pending' ? pending
    : statusFilter === 'Cancelled' ? docsInPeriod.filter((d) => d.is_cancelled)
    : activeDocsInPeriod.filter((d) => d.manual_status === statusFilter)

  const filtered = baseRows
    .filter((r) => !search.trim() || customerName(r.customer_id).toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'overdue-desc') return daysOverdue(b.issued_date) - daysOverdue(a.issued_date)
      if (sortBy === 'amount-desc') return (b.amount - b.paid_amount) - (a.amount - a.paid_amount)
      return new Date(b.issued_date) - new Date(a.issued_date)
    })

  // Cancelling isn't delete - it's "this is void, stop counting it," while
  // keeping the record on file. A cancelled document drops out of every
  // pending/total calculation on this screen and on Receivables (see
  // isResolved in lib/format.js), same as Payables already treats a
  // cancelled bill.
  const handleToggleCancelled = async (row) => {
    const willCancel = !row.is_cancelled
    if (willCancel && !window.confirm(`Cancel ${row[numberField]}? It'll stop counting toward what's owed, but stays on record.`)) return
    const { error: err } = await supabase.from(table).update({ is_cancelled: willCancel }).eq('id', row.id)
    if (err) { alert(`Couldn't update that: ${err.message}`); return }
    load()
  }

  // Owner-only, and deliberately not offered when a payment is on record -
  // this is a genuine, permanent delete (unlike Cancel, which keeps the
  // row), and deleting a document that still has a linked bank
  // transaction would orphan that transaction rather than cleaning it up.
  // Remove the payment from Cash & Bank first (which correctly reverses
  // the account balance), then delete becomes available. Also blocked for
  // a linked PI - deleting it out from under its invoice would leave that
  // invoice's linked_pi_id pointing at nothing.
  const handleDeleteDoc = async (row) => {
    if (row.linkedToInvoice) {
      alert(`${row[numberField]} is linked to Invoice ${row.linkedInvoiceNo} - delete or unlink that first.`)
      return
    }
    if (Number(row.paid_amount) > 0) {
      alert(`${row[numberField]} has a payment on record (${inr(row.paid_amount)} paid) - remove that from Cash & Bank first, then delete becomes available. This avoids leaving an orphaned transaction behind.`)
      return
    }
    if (!window.confirm(`Permanently delete ${row[numberField]}? This can't be undone.`)) return
    const { error: err } = await supabase.from(table).delete().eq('id', row.id)
    if (err) { alert(`Couldn't delete that: ${err.message}`); return }
    load()
  }

  const openConvertForm = (row) => {
    if (row.linkedToInvoice) {
      alert(`${row[numberField]} is already linked to Invoice ${row.linkedInvoiceNo}. Moving it again would create a second invoice for the same PI - manage this from Invoice Follow-up instead.`)
      return
    }
    setConvertingRowId(row.id)
    setConvertInvoiceNo('')
    setConvertDate(toISODate(new Date()))
    setConvertPaymentReceived(false)
    setConvertPayAmount('')
    setConvertPayAccountId(bankAccounts[0]?.id || '')
    setConvertPayDate(toISODate(new Date()))
    setConvertError(null)
    setExpandedId(null)
    setPayingRowId(null)
  }

  // Creates the real sales_invoices row from this PI - customer and amount
  // come straight from the PI, invoice number and date are what you type
  // (this tool still never invents a real invoice number). Whatever the PI
  // already had paid carries over as-is, and any bank_transaction already
  // tied to the PI is re-pointed to the new invoice rather than duplicated
  // - the cash was only ever received once. Separately, "payment already
  // received" is an actual question here, not an automatic assumption -
  // if checked, that amount is recorded as a genuinely new payment (its
  // own new bank_transaction), on top of whatever was carried over, since
  // it's real money that hasn't been recorded anywhere yet.
  const handleConvertToInvoice = async (row) => {
    setConvertError(null)
    if (!convertInvoiceNo.trim()) { setConvertError('Enter the real invoice number.'); return }
    if (!convertDate) { setConvertError('Pick the invoice date.'); return }
    let newPayment = 0
    if (convertPaymentReceived) {
      newPayment = parseFloat(convertPayAmount)
      if (!newPayment || newPayment <= 0) { setConvertError('Enter a valid amount received.'); return }
      if (!convertPayAccountId) { setConvertError('Select which cash or bank account this landed in.'); return }
      if (!convertPayDate) { setConvertError('Pick the date this payment was actually received.'); return }
    }

    setConvertingBusy(true)

    const carriedPaid = Number(row.paid_amount || 0)
    const totalPaid = Math.min(carriedPaid + newPayment, row.amount)
    // The real amount to record as a new transaction - capped by what's
    // actually left to pay after the carry-over, not the raw number typed
    // into the box. This is the actual fix: if the carried-over amount
    // already covers the full invoice (exactly what happened here -
    // ₹47,200 carried over, then ₹47,200 typed into "payment received"
    // thinking it needed re-entering), this correctly comes out to 0 -
    // nothing new gets recorded, instead of a second real transaction for
    // money that was never actually received twice.
    const actualNewAmount = Math.max(0, totalPaid - carriedPaid)

    const { data: newInvoice, error: insertErr } = await supabase.from('sales_invoices').insert({
      firm_id: firmId,
      customer_id: row.customer_id,
      invoice_no: convertInvoiceNo.trim(),
      issued_date: convertDate,
      amount: row.amount,
      paid_amount: totalPaid,
      status: totalPaid >= row.amount ? 'Paid' : 'Sent',
      linked_pi_id: row.id,
    }).select('id').single()

    if (insertErr) { setConvertingBusy(false); setConvertError(insertErr.message); return }

    if (carriedPaid > 0) {
      const { error: txnErr } = await supabase.from('bank_transactions')
        .update({ related_sales_invoice_id: newInvoice.id, related_proforma_invoice_id: null })
        .eq('related_proforma_invoice_id', row.id)
      if (txnErr) {
        setConvertingBusy(false)
        setConvertError(`Invoice ${convertInvoiceNo.trim()} was created, but re-pointing the existing payment record failed: ${txnErr.message}. Check Cash & Bank.`)
        load()
        return
      }
    }

    if (actualNewAmount > 0) {
      const account = bankAccounts.find((a) => a.id === convertPayAccountId)
      const { error: txnErr } = await supabase.from('bank_transactions').insert({
        firm_id: firmId,
        bank_account_id: convertPayAccountId,
        txn_date: convertPayDate,
        description: `Payment received — ${convertInvoiceNo.trim()} (${customerName(row.customer_id)})`,
        amount: actualNewAmount,
        reconciled: true,
        related_sales_invoice_id: newInvoice.id,
      })
      if (txnErr) {
        setConvertingBusy(false)
        setConvertError(`Invoice ${convertInvoiceNo.trim()} was created, but recording the new payment failed: ${txnErr.message}. Check Cash & Bank.`)
        load()
        return
      }
      if (account) {
        const { error: acctErr } = await supabase.from('bank_accounts').update({ balance: Number(account.balance) + actualNewAmount }).eq('id', convertPayAccountId)
        if (acctErr) {
          setConvertingBusy(false)
          setConvertError(`Invoice ${convertInvoiceNo.trim()} was created and the payment recorded, but the ${account.name} balance couldn't be updated: ${acctErr.message}.`)
          load()
          return
        }
      }
    }

    const { error: piErr } = await supabase.from(table).update({ manual_status: 'Invoiced' }).eq('id', row.id)
    if (piErr) {
      setConvertingBusy(false)
      setConvertError(`Invoice ${convertInvoiceNo.trim()} was created and the payment carried over, but this PI couldn't be tagged "Invoiced": ${piErr.message}.`)
      load()
      return
    }

    setConvertingBusy(false)
    setConvertingRowId(null)
    load()
  }

  // The per-row Status dropdown covers both manual_status values and the
  // real is_cancelled toggle in one control - this handles whichever was
  // picked as a single, clean database update, rather than chaining two
  // separate async calls that could race each other. Picking anything
  // other than Cancelled while a document is currently cancelled reinstates
  // it in the same update, rather than leaving it cancelled with a
  // confusing status tag layered on top.
  // Opens the payment-recording form rather than writing a value directly -
  // "Paid" and "Partially Paid" both mean money actually arrived, so both
  // need a real amount and a real bank account, the same as Record Payment
  // on Sales/Purchases, not just a text tag with no effect on Collected or
  // Cash & Bank. Paid defaults the amount to the full outstanding balance;
  // Partially Paid starts blank since there's no sensible default for it.
  const openPayForStatus = (row, targetStatus) => {
    setPayingRowId(row.id)
    setPayTargetStatus(targetStatus)
    setPayAmount(targetStatus === 'Paid' ? String((Number(row.amount) - Number(row.paid_amount || 0)).toFixed(2)) : '')
    setPayAccountId(bankAccounts[0]?.id || '')
    setPayDate(toISODate(new Date()))
    setPayError(null)
    setExpandedId(null)
    setConvertingRowId(null)
  }

  const handleStatusDropdownChange = async (row, value) => {
    if (value === 'Cancelled') {
      if (row.is_cancelled) return
      if (!window.confirm(`Cancel ${row[numberField]}? It'll stop counting toward what's owed, but stays on record.`)) return
      const { error: err } = await supabase.from(table).update({ is_cancelled: true }).eq('id', row.id)
      if (err) { alert(`Couldn't update that: ${err.message}`); return }
      load()
      return
    }
    if (value === 'Paid' || value === 'Partially Paid') {
      // The actual mechanism behind duplicate Cash & Bank entries: once a
      // PI is linked to an invoice, its own paid_amount is already just a
      // live reflection of that invoice (see the self-healing logic in
      // load() above). Recording a *new* payment here anyway would create
      // a second, completely independent transaction for money that's
      // already accounted for on the invoice side - exactly what created
      // the duplicate EST/225 + GF/26-27/0218 entries. Blocked outright
      // rather than just discouraged, since this is real money being
      // double-counted, not a cosmetic mistake.
      if (row.linkedToInvoice) {
        alert(`${row[numberField]} is linked to Invoice ${row.linkedInvoiceNo} - record or manage payments there instead (Invoice Follow-up), not here. This avoids the same payment ever being entered twice.`)
        return
      }
      openPayForStatus(row, value)
      return
    }
    const updates = { manual_status: value || null }
    if (row.is_cancelled) updates.is_cancelled = false
    const { error: err } = await supabase.from(table).update(updates).eq('id', row.id)
    if (err) { alert(`Couldn't update status: ${err.message}`); return }
    load()
  }

  // The actual payment: a real bank_transactions row (so it shows up in
  // Cash & Bank and contributes a real date to the DSO days-to-collect
  // trend), the bank account balance updated to match, paid_amount bumped
  // (added to whatever was already paid, not overwritten - covers more
  // than one partial payment over time), and manual_status set to
  // whichever of Paid/Partially Paid was picked. Same shape as
  // InvoiceListScreen.jsx's Record Payment, just reachable from the
  // Status dropdown here and PI-aware (related_proforma_invoice_id).
  const handleRecordPaymentForStatus = async (row) => {
    setPayError(null)
    const extra = parseFloat(payAmount)
    if (!extra || extra <= 0) { setPayError('Enter a valid amount.'); return }
    if (!payAccountId) { setPayError('Select which cash or bank account this landed in.'); return }
    if (!payDate) { setPayError('Pick the date this payment was actually received.'); return }

    const account = bankAccounts.find((a) => a.id === payAccountId)
    if (!account) { setPayError('That account could not be found - try reopening this form.'); return }

    const newPaid = Math.min((Number(row.paid_amount) || 0) + extra, row.amount)

    setPayingBusy(true)

    const updates = { paid_amount: newPaid, manual_status: payTargetStatus }
    if (row.is_cancelled) updates.is_cancelled = false
    const { error: docErr } = await supabase.from(table).update(updates).eq('id', row.id)

    let txnErr = null
    let acctErr = null
    if (!docErr) {
      const txnResult = await supabase.from('bank_transactions').insert({
        firm_id: firmId,
        bank_account_id: payAccountId,
        txn_date: payDate,
        description: `Payment received — ${row[numberField]} (${customerName(row.customer_id)})`,
        amount: extra,
        reconciled: true,
        related_sales_invoice_id: isPi ? null : row.id,
        related_proforma_invoice_id: isPi ? row.id : null,
      })
      txnErr = txnResult.error

      if (!txnErr) {
        const acctResult = await supabase
          .from('bank_accounts')
          .update({ balance: Number(account.balance) + extra })
          .eq('id', payAccountId)
        acctErr = acctResult.error
      }
    }

    setPayingBusy(false)

    if (docErr) { setPayError(docErr.message); return }
    if (txnErr || acctErr) {
      setPayError(
        `The status was updated, but recording the ${account.name} transaction failed: ${(txnErr || acctErr).message}. ` +
        `Check Cash & Bank and add it manually if needed.`
      )
      load()
      return
    }

    setPayingRowId(null)
    load()
  }

  const loadEmails = async (customerId) => {
    if (emailsByCustomer[customerId]) return
    const { data } = await supabase.from('customer_reminder_emails').select('id, email').eq('customer_id', customerId)
    setEmailsByCustomer((prev) => ({ ...prev, [customerId]: data ?? [] }))
  }

  // Explicit "Manage reminder emails" action now, not what a plain row
  // click does - row click opens the same Log-an-update drawer Receivables
  // and Payables use (see the click handler on <tr> below), for
  // consistency across all four AR/AP screens.
  const openManageEmails = (row) => {
    if (expandedId === row.id && sendConfirmId === null) { setExpandedId(null); return }
    setExpandedId(row.id)
    setSendConfirmId(null)
    setPayingRowId(null)
    setConvertingRowId(null)
    loadEmails(row.customer_id)
  }

  // "Send reminder now" no longer fires immediately - it opens the same
  // expand panel used for managing reminder emails, so the address it's
  // about to send to is visible (and editable, right there, if it's
  // missing or wrong) before anything actually goes out.
  const openSendConfirm = (row) => {
    setExpandedId(row.id)
    setSendConfirmId(row.id)
    setPayingRowId(null)
    setConvertingRowId(null)
    loadEmails(row.customer_id)
  }

  const handleAddEmail = async (customerId) => {
    if (!newEmail.trim()) return
    const { error: err } = await supabase.from('customer_reminder_emails').insert({ customer_id: customerId, email: newEmail.trim() })
    if (err) { alert(`Couldn't add that email: ${err.message}`); return }
    setNewEmail('')
    setEmailsByCustomer((prev) => { const next = { ...prev }; delete next[customerId]; return next })
    loadEmails(customerId)
  }

  const handleRemoveEmail = async (customerId, emailId) => {
    await supabase.from('customer_reminder_emails').delete().eq('id', emailId)
    setEmailsByCustomer((prev) => { const next = { ...prev }; delete next[customerId]; return next })
    loadEmails(customerId)
  }

  const handleTogglePause = async (row) => {
    setBusyId(row.id)
    const { error: err } = await supabase.from(table).update({ reminders_paused: !row.reminders_paused }).eq('id', row.id)
    setBusyId(null)
    if (err) { alert(`Couldn't update that: ${err.message}`); return }
    load()
  }

  const handleSendNow = async (row) => {
    setBusyId(row.id)
    setActionMsg((prev) => ({ ...prev, [row.id]: null }))
    const { data, error: err } = await supabase.functions.invoke('send-payment-reminder', {
      body: { documentType: isPi ? 'proforma_invoice' : 'invoice', documentId: row.id },
    })
    setBusyId(null)
    setSendConfirmId(null)
    if (err) {
      let message = err.message
      try {
        if (err.context) {
          const body = await err.context.json()
          if (body?.error) message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error)
        }
      } catch { /* fall back to err.message */ }
      setActionMsg((prev) => ({ ...prev, [row.id]: { type: 'error', text: message } }))
      return
    }
    setActionMsg((prev) => ({ ...prev, [row.id]: { type: 'ok', text: `Sent a "${STAGE_LABEL[data.stage] || data.stage}" to ${data.sentTo.join(', ')}` } }))
    load()
  }

  const handlePreview = async (row) => {
    const party = customers.find((c) => c.id === row.customer_id) || null
    const { url, filename } = await previewDocumentPdf({
      firm: firm || {},
      party,
      doc: {
        number: row[numberField],
        issued_date: row.issued_date,
        due_date: null,
        amount: row.amount,
        paid_amount: row.paid_amount,
        status: (Number(row.amount) - Number(row.paid_amount || 0)) <= 0 ? 'Paid' : 'Sent',
        isSales: true,
        docTypeLabel: isPi ? 'PROFORMA INVOICE' : undefined,
        ...itemTaxFieldsFromRow(row),
      },
    })
    setPreview({ url, filename })
  }

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  const handleAction = (row, action) => {
    if (action === 'preview') handlePreview(row)
    else if (action === 'send') openSendConfirm(row)
    else if (action === 'pause') handleTogglePause(row)
    else if (action === 'update') setSelectedCustomerId(row.customer_id)
    else if (action === 'emails') openManageEmails(row)
    else if (action === 'cancel') handleToggleCancelled(row)
    else if (action === 'convert') openConvertForm(row)
    else if (action === 'delete') handleDeleteDoc(row)
  }

  const addComm = async ({ channel, tag, note }) => {
    setSaving(true)
    const { error: insertErr } = await supabase.from('ar_comms').insert({ firm_id: firmId, customer_id: selectedCustomerId, channel, tag, note })
    setSaving(false)
    if (insertErr) { alert(`Couldn't save that update: ${insertErr.message}`); return }
    await load()
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  const exportRows = filtered.map((r) => [
    customerName(r.customer_id), r[numberField], r.issued_date,
    inr(balanceDue(r)), daysOverdue(r.issued_date), r.manual_status || '—',
    r.last_reminder_sent_date ? `${STAGE_LABEL[r.last_reminder_stage] || r.last_reminder_stage} on ${r.last_reminder_sent_date}` : 'Never',
    r.reminders_paused ? 'Paused' : 'Active',
  ])
  const exportColumns = ['Customer', docLabel + ' #', 'Issued', 'Amount Pending', 'Days Overdue', 'Status', 'Last Reminder', 'Reminders']

  const handleExportCsv = () => downloadCsv(`${docType}-followup`, exportColumns, exportRows)
  const handleExportPdf = () => downloadListPdf({ title: `${docLabel} Follow-up`, firm, filename: `${docType}-followup`, columns: exportColumns.map((c) => ({ label: c })), rows: exportRows })
  const handleExportWord = () => downloadListDocx({ title: `${docLabel} Follow-up`, firm, filename: `${docType}-followup`, columns: exportColumns.map((c) => ({ label: c })), rows: exportRows })

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title={`${docLabel} Follow-up`} note={`pending ${docLabel.toLowerCase()}s, days overdue, and reminder status`} />

      <div className="grid-3">
        <StatCard label={`${docLabel}s in period`} value={inr(totals.invoiced)} />
        <StatCard label="Collected in period" value={inr(totals.collected)} accent />
        <StatCard label="Still pending" value={inr(totals.pending)} />
      </div>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search customer name...' }}
        filters={[
          {
            label: 'Status', value: statusFilter, onChange: setStatusFilter,
            options: [
              { value: 'all', label: 'All' },
              { value: 'pending', label: 'Pending' },
              ...MANUAL_STATUSES.map((s) => ({ value: s, label: s })),
              { value: 'Cancelled', label: 'Cancelled' },
            ],
          },
        ]}
        period={{ value: period, onChange: setPeriod, customFrom, customTo, setCustomFrom, setCustomTo }}
        sort={{ value: sortBy, onChange: setSortBy, options: [
          { value: 'overdue-desc', label: 'Most overdue first' },
          { value: 'amount-desc', label: 'Amount pending: high to low' },
          { value: 'date-desc', label: 'Newest issued first' },
        ] }}
        exportOptions={{ onExcel: handleExportCsv, onPdf: handleExportPdf, onWord: handleExportWord, disabled: filtered.length === 0 }}
      />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}>
          <h2>
            {statusFilter === 'all' ? `All ${docLabel.toLowerCase()}s`
              : statusFilter === 'pending' ? `Pending ${docLabel.toLowerCase()}s`
              : `${statusFilter} ${docLabel.toLowerCase()}s`}
          </h2>
          <span className="section-header__note">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="table-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Customer</th><th>{docLabel} #</th><th>Issued</th>
                <th className="num">Amount Pending</th><th>Due Date</th><th className="num">Days Overdue</th>
                <th>Status</th><th>Last Reminder</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const overdue = daysOverdue(r.issued_date)
                const dueDate = new Date(r.issued_date + 'T00:00:00')
                dueDate.setDate(dueDate.getDate() + graceDays)
                const busy = busyId === r.id
                const msg = actionMsg[r.id]
                return (
                  <Fragment key={r.id}>
                    <tr className="ledger-row ledger-row--clickable" onClick={() => setSelectedCustomerId(r.customer_id)}>
                      <td>{customerName(r.customer_id)}</td>
                      <td className="mono">{r[numberField]}</td>
                      <td className="mono">{toISODate(new Date(r.issued_date))}</td>
                      <td className="num mono">
                        {inr(balanceDue(r))}
                        {r.linkedToInvoice && <span title="This PI is linked to a Sales Invoice - the amount shown here follows that invoice's current payment status, not a separately-tracked figure on the PI itself." style={{ marginLeft: 4, color: 'var(--paper-dim)', cursor: 'help' }}>ⓘ</span>}
                      </td>
                      <td className="mono">{toISODate(dueDate)}</td>
                      <td className="num mono" style={{ color: overdue > 0 && !r.is_cancelled ? 'var(--brick)' : 'inherit' }}>{overdue > 0 && !r.is_cancelled ? overdue : '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className="select select--sm"
                          value={r.is_cancelled ? 'Cancelled' : (r.manual_status || '')}
                          onChange={(e) => handleStatusDropdownChange(r, e.target.value || null)}
                        >
                          <option value="">—</option>
                          {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          <option value="Cancelled">Cancelled</option>
                        </select>
                      </td>
                      <td>
                        {r.last_reminder_sent_date
                          ? <span className="login-footnote" style={{ margin: 0 }}>{STAGE_LABEL[r.last_reminder_stage] || r.last_reminder_stage} · {r.last_reminder_sent_date}</span>
                          : <span className="pill pill--neutral">Never sent</span>}
                        {r.reminders_paused && <span className="pill pill--warn" style={{ marginLeft: 6 }}>Paused</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className="select select--sm"
                          value=""
                          disabled={busy}
                          onChange={(e) => { const action = e.target.value; if (action) handleAction(r, action) }}
                        >
                          <option value="" disabled>{busy ? 'Working…' : 'Actions…'}</option>
                          <option value="preview">Preview</option>
                          <option value="send" disabled={r.reminders_paused}>Send reminder now</option>
                          <option value="pause">{r.reminders_paused ? 'Resume reminders' : 'Pause reminders'}</option>
                          <option value="update">Log an update</option>
                          <option value="emails">Manage reminder emails</option>
                          {isPi && <option value="convert">{r.linkedToInvoice ? `Already → ${r.linkedInvoiceNo}` : 'Move to Invoice…'}</option>}
                          <option value="cancel">{`Cancel ${docLabel.toLowerCase()}`}</option>
                          {role === 'Owner' && <option value="delete">Delete</option>}
                        </select>
                      </td>
                    </tr>
                    {msg && (
                      <tr>
                        <td colSpan={9} style={{ padding: '0 12px 8px', color: msg.type === 'ok' ? 'var(--teal)' : 'var(--brick)', fontSize: '12.5px' }}>
                          {msg.text}
                        </td>
                      </tr>
                    )}
                    {expandedId === r.id && (
                      <tr>
                        <td colSpan={9} style={{ padding: 12, background: 'var(--panel-alt)' }}>
                          <div className="login-footnote" style={{ margin: '0 0 8px', textTransform: 'uppercase', fontSize: 11 }}>
                            {sendConfirmId === r.id
                              ? `This reminder will go to — ${customerName(r.customer_id)}`
                              : `Reminder emails for ${customerName(r.customer_id)}`}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                            {(emailsByCustomer[r.customer_id] ?? []).map((e) => (
                              <span key={e.id} className="pill pill--neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {e.email}
                                <button className="link-btn" style={{ padding: 0, color: 'var(--brick)' }} onClick={() => handleRemoveEmail(r.customer_id, e.id)}>×</button>
                              </span>
                            ))}
                            {(emailsByCustomer[r.customer_id]?.length ?? 0) === 0 && (
                              customers.find((c) => c.id === r.customer_id)?.email ? (
                                <span className="login-footnote" style={{ margin: 0 }}>
                                  No reminder emails added — will use {customerName(r.customer_id)}'s main email: {customers.find((c) => c.id === r.customer_id)?.email}
                                </span>
                              ) : (
                                <span className="text-[12.5px]" style={{ color: 'var(--brick)' }}>
                                  No email on file for this customer yet — add one below before sending.
                                </span>
                              )
                            )}
                          </div>
                          <div className="add-comm-row" style={{ maxWidth: 420 }}>
                            <input className="text-input" type="email" placeholder="Add an email address" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                            <button type="button" className="btn-primary" onClick={() => handleAddEmail(r.customer_id)}>Add</button>
                          </div>
                          {sendConfirmId === r.id && (
                            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                              <button
                                className="btn-primary" disabled={busyId === r.id}
                                onClick={() => handleSendNow(r)}
                              >
                                {busyId === r.id ? 'Sending…' : 'Confirm & Send'}
                              </button>
                              <button className="link-btn" onClick={() => { setSendConfirmId(null); setExpandedId(null) }}>Cancel</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    {payingRowId === r.id && (
                      <tr>
                        <td colSpan={9} style={{ padding: 12, background: 'var(--panel-alt)' }}>
                          <div className="login-footnote" style={{ margin: '0 0 8px', textTransform: 'uppercase', fontSize: 11 }}>
                            Record payment — marking {payTargetStatus} on {r[numberField]}
                          </div>
                          <div className="add-comm-row">
                            <input
                              className="text-input" type="number" step="0.01" placeholder="Amount received"
                              value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                            />
                            <select className="select" value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)}>
                              <option value="" disabled>Select account…</option>
                              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                            <input
                              className="text-input" type="date"
                              value={payDate} onChange={(e) => setPayDate(e.target.value)}
                            />
                          </div>
                          {bankAccounts.length === 0 && (
                            <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>No bank/cash accounts set up yet — add one in Cash & Bank first.</p>
                          )}
                          {payError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{payError}</p>}
                          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                            <button className="btn-primary" disabled={payingBusy} onClick={() => handleRecordPaymentForStatus(r)}>
                              {payingBusy ? 'Saving…' : 'Save payment'}
                            </button>
                            <button type="button" className="link-btn" onClick={() => { setPayingRowId(null); setPayError(null) }}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {convertingRowId === r.id && (
                      <tr>
                        <td colSpan={9} style={{ padding: 12, background: 'var(--panel-alt)' }}>
                          <div className="login-footnote" style={{ margin: '0 0 8px', textTransform: 'uppercase', fontSize: 11 }}>
                            Move {r[numberField]} to a Sales Invoice
                          </div>
                          <div className="add-comm-row">
                            <input
                              className="text-input" placeholder="Real invoice number"
                              value={convertInvoiceNo} onChange={(e) => setConvertInvoiceNo(e.target.value)}
                            />
                            <input
                              className="text-input" type="date"
                              value={convertDate} onChange={(e) => setConvertDate(e.target.value)}
                            />
                          </div>
                          <p className="login-footnote" style={{ marginTop: 6 }}>
                            {Number(r.paid_amount) > 0
                              ? `Amount (${inr(r.amount)}) and what's already paid on this PI (${inr(r.paid_amount)}) carry over automatically — that part is already handled, don't re-enter it below.`
                              : `Amount (${inr(r.amount)}) carries over automatically.`}
                          </p>

                          {Number(r.paid_amount) >= Number(r.amount) ? (
                            <p className="login-footnote" style={{ marginTop: 10 }}>
                              This PI is already fully paid — that carries over automatically, so there's nothing further to record here.
                            </p>
                          ) : (
                            <>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '13px', color: 'var(--paper)' }}>
                                <input type="checkbox" checked={convertPaymentReceived} onChange={(e) => setConvertPaymentReceived(e.target.checked)} />
                                {Number(r.paid_amount) > 0
                                  ? `More money came in on top of the ${inr(r.paid_amount)} above`
                                  : 'Payment already received for this invoice'}
                              </label>
                              {Number(r.paid_amount) > 0 && (
                                <p className="login-footnote" style={{ marginTop: 2 }}>
                                  Only check this for a genuinely additional amount — the {inr(r.paid_amount)} already carries over on its own.
                                </p>
                              )}

                              {convertPaymentReceived && (
                                <div className="add-comm-row" style={{ marginTop: 8 }}>
                                  <input
                                    className="text-input" type="number" step="0.01" placeholder="Amount received"
                                    value={convertPayAmount} onChange={(e) => setConvertPayAmount(e.target.value)}
                                  />
                                  <select className="select" value={convertPayAccountId} onChange={(e) => setConvertPayAccountId(e.target.value)}>
                                    <option value="" disabled>Select account…</option>
                                    {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                  </select>
                                  <input
                                    className="text-input" type="date"
                                    value={convertPayDate} onChange={(e) => setConvertPayDate(e.target.value)}
                                  />
                                </div>
                              )}
                            </>
                          )}
                          {convertPaymentReceived && bankAccounts.length === 0 && (
                            <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>No bank/cash accounts set up yet — add one in Cash & Bank first.</p>
                          )}

                          {convertError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{convertError}</p>}
                          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                            <button className="btn-primary" disabled={convertingBusy} onClick={() => handleConvertToInvoice(r)}>
                              {convertingBusy ? 'Creating…' : 'Create invoice'}
                            </button>
                            <button type="button" className="link-btn" onClick={() => { setConvertingRowId(null); setConvertError(null) }}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {filtered.length === 0 && <EmptyRow colSpan={9}>No {docLabel.toLowerCase()}s match these filters.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>

      {preview && <PdfPreviewModal url={preview.url} filename={preview.filename} onClose={closePreview} />}

      {selectedCustomer && (
        <CommDrawer
          customer={selectedCustomer}
          docLabel={docLabel}
          openDocs={pending
            .filter((d) => d.customer_id === selectedCustomer.id)
            .map((d) => ({
              id: d.id, number: d[numberField], issued_date: d.issued_date,
              amountDue: d.amount - d.paid_amount,
              statusLabel: daysOverdue(d.issued_date) > 0 ? 'Overdue' : 'Sent',
            }))}
          comms={comms.filter((c) => c.customer_id === selectedCustomer.id)}
          onAddComm={addComm}
          onClose={() => setSelectedCustomerId(null)}
          saving={saving}
        />
      )}
    </>
  )
}
