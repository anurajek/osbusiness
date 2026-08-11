import { useEffect, useState } from 'react'
import { UploadCloud, Undo2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { inr, toISODate, computeStatus, statusForStorage } from '../lib/format'
import { parseCsvFile, guessMapping, parseFlexibleDate, parseAmount } from '../lib/importParsing'
import { SectionHeader } from '../components/ui'

const PARTY_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'address', label: 'Address' },
  { key: 'email', label: 'Email' },
  { key: 'contact', label: 'Contact' },
]

// All optional - when mapped, the PDF preview shows a real itemized line +
// tax breakdown (matching how Zoho/Tally present a bill); when left
// unmapped, everything falls back to the plain single-total summary
// exactly as before. One line item per document, not a full multi-line
// items table - see the migration file's header comment for why.
const ITEM_TAX_FIELDS = [
  { key: 'item_description', label: 'Item Description' },
  { key: 'item_quantity', label: 'Quantity', type: 'number' },
  { key: 'item_rate', label: 'Rate', type: 'number' },
  { key: 'subtotal', label: 'Sub Total', type: 'number' },
  { key: 'discount_amount', label: 'Discount', type: 'number' },
  { key: 'cgst_rate', label: 'CGST Rate (%)', type: 'number' },
  { key: 'cgst_amount', label: 'CGST Amount', type: 'number' },
  { key: 'sgst_rate', label: 'SGST Rate (%)', type: 'number' },
  { key: 'sgst_amount', label: 'SGST Amount', type: 'number' },
  { key: 'igst_rate', label: 'IGST Rate (%)', type: 'number' },
  { key: 'igst_amount', label: 'IGST Amount', type: 'number' },
]

const TARGETS = {
  customers: { label: 'Customers', table: 'customers', kind: 'party', fields: PARTY_FIELDS, dedupeField: 'name', dedupeColumn: 'name', dedupeLabel: 'Name' },
  suppliers: { label: 'Suppliers', table: 'suppliers', kind: 'party', fields: PARTY_FIELDS, dedupeField: 'name', dedupeColumn: 'name', dedupeLabel: 'Name' },
  sales_invoices: {
    label: 'Sales Invoices', table: 'sales_invoices', kind: 'doc', isSales: true, hasDueDate: true,
    partyTable: 'customers', partyField: 'customer_id', partyLabel: 'Customer', docLabel: 'Invoice #', dbNumberField: 'invoice_no',
    dedupeField: 'doc_no', dedupeColumn: 'invoice_no', dedupeLabel: 'Invoice #',
    fields: [
      { key: 'party_name', label: 'Customer Name', required: true },
      { key: 'doc_no', label: 'Invoice #', required: true },
      { key: 'issued_date', label: 'Issued Date', required: true, type: 'date' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'amount', label: 'Amount', required: true, type: 'number' },
      { key: 'paid_amount', label: 'Paid Amount', type: 'number' },
      ...ITEM_TAX_FIELDS,
    ],
  },
  proforma_invoices: {
    label: 'Proforma Invoices', table: 'proforma_invoices', kind: 'doc', isSales: true, hasDueDate: false,
    partyTable: 'customers', partyField: 'customer_id', partyLabel: 'Customer', docLabel: 'PI #', dbNumberField: 'pi_no',
    dedupeField: 'doc_no', dedupeColumn: 'pi_no', dedupeLabel: 'PI #',
    fields: [
      { key: 'party_name', label: 'Customer Name', required: true },
      { key: 'doc_no', label: 'PI #', required: true },
      { key: 'issued_date', label: 'Issued Date', required: true, type: 'date' },
      { key: 'amount', label: 'Amount', required: true, type: 'number' },
      { key: 'paid_amount', label: 'Paid Amount', type: 'number' },
      ...ITEM_TAX_FIELDS,
    ],
  },
  purchase_bills: {
    label: 'Purchase Bills', table: 'purchase_bills', kind: 'doc', isSales: false, hasDueDate: true,
    partyTable: 'suppliers', partyField: 'supplier_id', partyLabel: 'Supplier', docLabel: 'Bill #', dbNumberField: 'bill_no',
    dedupeField: 'doc_no', dedupeColumn: 'bill_no', dedupeLabel: 'Bill #',
    fields: [
      { key: 'party_name', label: 'Supplier Name', required: true },
      { key: 'doc_no', label: 'Bill #', required: true },
      { key: 'issued_date', label: 'Issued Date', required: true, type: 'date' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'amount', label: 'Amount', required: true, type: 'number' },
      { key: 'paid_amount', label: 'Paid Amount', type: 'number' },
      ...ITEM_TAX_FIELDS,
    ],
  },
}

function validateRow(raw, mapping, fields) {
  const value = (key) => {
    const header = mapping[key]
    return header ? String(raw[header] ?? '').trim() : ''
  }
  const parsed = {}
  const errors = []

  for (const field of fields) {
    const v = value(field.key)
    if (field.required && !v) { errors.push(`Missing ${field.label}`); continue }
    if (!v) { parsed[field.key] = null; continue }

    if (field.type === 'date') {
      const iso = parseFlexibleDate(v)
      if (!iso) errors.push(`Unrecognized date for ${field.label}: "${v}"`)
      parsed[field.key] = iso
    } else if (field.type === 'number') {
      const n = parseAmount(v)
      if (n === null) errors.push(`Unrecognized amount for ${field.label}: "${v}"`)
      else if (field.key === 'amount' && n <= 0) errors.push('Amount must be greater than zero')
      parsed[field.key] = n
    } else {
      parsed[field.key] = v
    }
  }
  return { parsed, errors }
}

const SUMMABLE_ITEM_FIELDS = ['subtotal', 'discount_amount', 'cgst_amount', 'sgst_amount', 'igst_amount']

// Some accounting exports (Zoho among them) put one CSV row per line item,
// repeating the invoice/PI/bill number and its overall total on every row
// for that document - a real, common export shape, not malformed data.
// Without this, every row past the first for the same document number
// looks like a duplicate and gets rejected. This groups already-validated
// rows by their document number, and for any group with more than one row:
// merges them into a single document using the shared invoice-level fields
// (customer, number, date, amount, paid amount - these should be identical
// across the group, and if they're not, that's a real data problem worth
// surfacing rather than silently guessing which row is right) plus the
// SUM of whichever tax/subtotal fields are present, and a combined
// description. item_quantity/item_rate are dropped for a merged group -
// summing a quantity or rate across different line items doesn't mean
// anything, so the PDF falls back to showing the combined description
// against the summed subtotal instead of a false single qty x rate line.
function mergeLineItemGroups(rows, dedupeField, dedupeLabel) {
  const groups = new Map()
  const order = []
  for (const r of rows) {
    const normalized = r.errors.length === 0 ? String(r.parsed[dedupeField] ?? '').trim().toLowerCase() : ''
    const key = normalized ? normalized : `__row_${r.rowNumber}`
    if (!groups.has(key)) { groups.set(key, []); order.push(key) }
    groups.get(key).push(r)
  }

  const result = []
  for (const key of order) {
    const group = groups.get(key)
    if (group.length === 1 || group[0].errors.length > 0) { result.push(...group); continue }

    const amounts = group.map((r) => Number(r.parsed.amount))
    const consistent = amounts.every((a) => Math.abs(a - amounts[0]) < 0.01)
    if (!consistent) {
      const amountList = amounts.map((a) => `₹${a}`).join(', ')
      for (const r of group) {
        r.errors.push(`Multiple rows share ${dedupeLabel} "${r.parsed[dedupeField]}" but disagree on Amount (${amountList}) - fix the CSV so every line for this document has the same total, then re-import`)
      }
      result.push(...group)
      continue
    }

    const first = group[0]
    const combinedDescription = group
      .map((r) => r.parsed.item_description)
      .filter(Boolean)
      .join('; ')
    const summed = {}
    for (const f of SUMMABLE_ITEM_FIELDS) {
      const present = group.some((r) => r.parsed[f] != null)
      summed[f] = present ? group.reduce((s, r) => s + (Number(r.parsed[f]) || 0), 0) : null
    }

    result.push({
      ...first,
      rowNumber: group.map((r) => r.rowNumber).join('-'),
      mergedRowCount: group.length,
      parsed: {
        ...first.parsed,
        item_description: combinedDescription || first.parsed.item_description,
        item_quantity: null,
        item_rate: null,
        ...summed,
      },
    })
  }
  return result
}

export default function ImportScreen() {
  const { firmId } = useFirm()
  const [target, setTarget] = useState('customers')
  const [step, setStep] = useState('upload') // upload | map | preview | done
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [rawRows, setRawRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [parseError, setParseError] = useState(null)

  const [validated, setValidated] = useState([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [result, setResult] = useState(null)

  const [batches, setBatches] = useState([])
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [undoingId, setUndoingId] = useState(null)

  const loadBatches = async () => {
    if (!firmId) return
    setLoadingBatches(true)
    const { data } = await supabase.from('import_batches').select('*').eq('firm_id', firmId).order('created_at', { ascending: false })
    setBatches(data ?? [])
    setLoadingBatches(false)
  }
  useEffect(() => { loadBatches() }, [firmId]) // eslint-disable-line react-hooks/exhaustive-deps

  const def = TARGETS[target]

  const resetWizard = () => {
    setStep('upload'); setFileName(''); setHeaders([]); setRawRows([])
    setMapping({}); setParseError(null); setValidated([]); setImportError(null); setResult(null)
  }

  const handleTargetChange = (key) => { setTarget(key); resetWizard() }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)
    setFileName(file.name)
    try {
      const { headers: h, rows } = await parseCsvFile(file)
      if (rows.length === 0) { setParseError('That file has no data rows.'); return }
      setHeaders(h)
      setRawRows(rows)
      setMapping(guessMapping(h, def.fields))
      setStep('map')
    } catch (err) {
      setParseError(`Couldn't read that file: ${err.message || err}`)
    }
  }

  const [checkingDuplicates, setCheckingDuplicates] = useState(false)

  const handleContinueToPreview = async () => {
    const missing = def.fields.filter((f) => f.required && !mapping[f.key])
    if (missing.length > 0) {
      setParseError(`Map a column for: ${missing.map((f) => f.label).join(', ')}`)
      return
    }
    setParseError(null)
    setCheckingDuplicates(true)

    // Two different kinds of duplicate to catch: a row whose invoice/bill
    // number (or party name) already exists in your books, and a row
    // that's just repeated more than once within the file itself (e.g. an
    // export with the same invoice listed twice, or re-uploading the same
    // file by mistake). Both would otherwise silently create a second copy
    // of something that already exists.
    const { data: existingRows, error: existingErr } = await supabase
      .from(def.table)
      .select(def.dedupeColumn)
      .eq('firm_id', firmId)
    if (existingErr) {
      setCheckingDuplicates(false)
      setParseError(`Couldn't check for duplicates: ${existingErr.message}`)
      return
    }
    const existingKeys = new Set((existingRows ?? []).map((r) => String(r[def.dedupeColumn] ?? '').trim().toLowerCase()))
    const seenInFile = new Set()

    let rows = rawRows.map((raw, i) => {
      const { parsed, errors } = validateRow(raw, mapping, def.fields)
      return { rowNumber: i + 2, raw, parsed, errors } // +2: header row + 1-index
    })

    // Doc-kind imports only (customers/suppliers never have this) - merge
    // rows that share a document number into one document before running
    // the duplicate check below, so a multi-line-item export doesn't look
    // like the same invoice imported several times over.
    if (def.kind === 'doc') {
      rows = mergeLineItemGroups(rows, def.dedupeField, def.dedupeLabel)
    }

    rows = rows.map((r) => {
      if (r.errors.length === 0) {
        const dedupeValue = r.parsed[def.dedupeField]
        const normalized = dedupeValue ? String(dedupeValue).trim().toLowerCase() : ''
        if (normalized && existingKeys.has(normalized)) {
          r.errors.push(`Duplicate — ${def.dedupeLabel} "${dedupeValue}" already exists in your books`)
        } else if (normalized && seenInFile.has(normalized)) {
          r.errors.push(`Duplicate — "${dedupeValue}" appears more than once in this file`)
        } else if (normalized) {
          seenInFile.add(normalized)
        }
      }
      return r
    })
    setValidated(rows)
    setCheckingDuplicates(false)
    setStep('preview')
  }

  const validRows = validated.filter((r) => r.errors.length === 0)
  const invalidRows = validated.filter((r) => r.errors.length > 0)

  const handleImport = async () => {
    if (validRows.length === 0) return
    setImporting(true)
    setImportError(null)

    const { data: batch, error: batchErr } = await supabase
      .from('import_batches')
      .insert({ firm_id: firmId, target_type: target, source_filename: fileName, row_count: validRows.length })
      .select('id')
      .single()
    if (batchErr) { setImporting(false); setImportError(batchErr.message); return }

    if (def.kind === 'party') {
      const { error: err } = await supabase.from(def.table).insert(
        validRows.map((r) => ({ firm_id: firmId, import_batch_id: batch.id, ...r.parsed }))
      )
      setImporting(false)
      if (err) { setImportError(err.message); return }
      setResult({ inserted: validRows.length, newParties: 0, skipped: invalidRows.length })
    } else {
      // Match party_name against existing parties (case-insensitive), and
      // auto-create any that don't exist yet - tagged with the same batch
      // id, so Undo cleans those up too, not just the invoices/bills.
      const { data: existingParties } = await supabase.from(def.partyTable).select('id, name').eq('firm_id', firmId)
      const nameToId = new Map((existingParties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]))
      let newPartyCount = 0

      for (const row of validRows) {
        const key = row.parsed.party_name.trim().toLowerCase()
        if (!nameToId.has(key)) {
          const { data: created, error: createErr } = await supabase
            .from(def.partyTable)
            .insert({ firm_id: firmId, import_batch_id: batch.id, name: row.parsed.party_name.trim() })
            .select('id')
            .single()
          if (createErr) { setImporting(false); setImportError(`Couldn't create ${def.partyLabel.toLowerCase()} "${row.parsed.party_name}": ${createErr.message}`); return }
          nameToId.set(key, created.id)
          newPartyCount += 1
        }
      }

      const baseStatus = def.isSales ? 'Sent' : 'Approved'
      const ITEM_TAX_KEYS = ['item_description', 'item_quantity', 'item_rate', 'subtotal', 'discount_amount', 'cgst_rate', 'cgst_amount', 'sgst_rate', 'sgst_amount', 'igst_rate', 'igst_amount']
      const docRows = validRows.map((r) => {
        const paidAmount = r.parsed.paid_amount || 0
        const payload = {
          firm_id: firmId,
          import_batch_id: batch.id,
          [def.partyField]: nameToId.get(r.parsed.party_name.trim().toLowerCase()),
          [def.dbNumberField]: r.parsed.doc_no,
          issued_date: r.parsed.issued_date,
          amount: r.parsed.amount,
          paid_amount: paidAmount,
        }
        // validateRow always sets a key here for every field in the target's
        // field list - null when a column wasn't mapped or was left blank
        // in the CSV, an actual value otherwise. Writing an explicit null
        // has the same effect as not writing the column at all (both leave
        // it unset), so this is safe either way.
        for (const key of ITEM_TAX_KEYS) {
          if (key in r.parsed) payload[key] = r.parsed[key]
        }
        if (def.hasDueDate) {
          payload.due_date = r.parsed.due_date || null
          const computed = computeStatus({ amount: r.parsed.amount, paid_amount: paidAmount, due_date: r.parsed.due_date }, baseStatus)
          payload.status = statusForStorage(computed, def.isSales)
        } else {
          // Proforma Invoices don't have a due_date column - "overdue" is
          // computed from the firm's reminder grace period at display
          // time (see PaymentFollowUpScreen.jsx), not stored as a status.
          payload.status = paidAmount >= r.parsed.amount ? 'Paid' : 'Sent'
        }
        return payload
      })

      const { error: err } = await supabase.from(def.table).insert(docRows)
      setImporting(false)
      if (err) { setImportError(`${newPartyCount} ${def.partyLabel.toLowerCase()}(s) were created, but importing the documents failed: ${err.message}. Use Undo below to clean up.`); return }
      setResult({ inserted: docRows.length, newParties: newPartyCount, skipped: invalidRows.length })
    }

    setStep('done')
    loadBatches()
  }

  const handleUndo = async (batch) => {
    if (!window.confirm(`Undo this import (${batch.row_count} ${TARGETS[batch.target_type].label.toLowerCase()} from ${batch.source_filename || 'unnamed file'})? This permanently deletes everything it created.`)) return
    setUndoingId(batch.id)
    const t = TARGETS[batch.target_type]
    // Delete documents first if this was a doc import, then any parties it
    // auto-created, then the batch record itself.
    if (t.kind === 'doc') {
      await supabase.from(t.table).delete().eq('import_batch_id', batch.id)
      await supabase.from(t.partyTable).delete().eq('import_batch_id', batch.id)
    } else {
      await supabase.from(t.table).delete().eq('import_batch_id', batch.id)
    }
    const { error: err } = await supabase.from('import_batches').delete().eq('id', batch.id)
    setUndoingId(null)
    if (err) { alert(`Couldn't remove the import record itself (the data was deleted though): ${err.message}`); }
    loadBatches()
  }

  return (
    <>
      <SectionHeader title="Import Data" note="bring in customers, suppliers, invoices, and bills from a CSV export" />

      <div className="card">
        <div className="section-header" style={{ marginBottom: 12 }}><h2>What are you importing?</h2></div>
        <div className="filter-bar" style={{ marginBottom: 4 }}>
          <div className="filter-field">
            <label>Import type</label>
            <select className="select select--sm" value={target} onChange={(e) => handleTargetChange(e.target.value)}>
              {Object.entries(TARGETS).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
            </select>
          </div>
        </div>

        {step === 'upload' && (
          <div style={{ marginTop: 16 }}>
            <p className="login-footnote" style={{ marginBottom: 10 }}>
              Export {def.label.toLowerCase()} from Tally, Zoho Books, Excel, or anywhere else as a <strong>CSV file</strong>, then upload it here.
              {def.kind === 'doc' && ` Any ${def.partyLabel.toLowerCase()} name that doesn't already exist will be created automatically.`}
            </p>
            <label className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <UploadCloud size={15} /> Choose CSV file
              <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />
            </label>
            {parseError && <p className="text-[12.5px]" style={{ color: 'var(--brick)', marginTop: 10 }}>{parseError}</p>}
          </div>
        )}

        {step === 'map' && (
          <div style={{ marginTop: 16 }}>
            <p className="login-footnote" style={{ marginBottom: 12 }}>
              <strong>{fileName}</strong> — {rawRows.length} row{rawRows.length !== 1 ? 's' : ''} found. Match each field below to a column from your file.
            </p>
            <div className="table-scroll">
              <table className="ledger-table">
                <thead><tr><th>Field</th><th>Column in your file</th></tr></thead>
                <tbody>
                  {def.fields.map((f) => (
                    <tr key={f.key} className="ledger-row">
                      <td>{f.label}{f.required && <span style={{ color: 'var(--brick)' }}> *</span>}</td>
                      <td>
                        <select
                          className="select select--sm"
                          value={mapping[f.key] || ''}
                          onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                        >
                          <option value="">— Don't import —</option>
                          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parseError && <p className="text-[12.5px]" style={{ color: 'var(--brick)', marginTop: 10 }}>{parseError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn-primary" disabled={checkingDuplicates} onClick={handleContinueToPreview}>
                {checkingDuplicates ? 'Checking for duplicates…' : 'Continue'}
              </button>
              <button className="link-btn" onClick={resetWizard}>Start over</button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div style={{ marginTop: 16 }}>
            <p className="text-[13px]" style={{ marginBottom: 10 }}>
              <strong style={{ color: 'var(--teal)' }}>{validRows.length} ready to import</strong>
              {invalidRows.length > 0 && <span style={{ color: 'var(--brick)' }}> · {invalidRows.length} will be skipped (errors below)</span>}
            </p>
            <div className="table-scroll" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    {def.fields.map((f) => <th key={f.key}>{f.label}</th>)}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {validated.slice(0, 200).map((r) => (
                    <tr key={r.rowNumber} className="ledger-row">
                      <td className="mono">{r.rowNumber}</td>
                      {def.fields.map((f) => (
                        <td key={f.key} className={f.type === 'number' ? 'num mono' : ''}>
                          {f.type === 'number' && r.parsed[f.key] != null ? inr(r.parsed[f.key]) : (r.parsed[f.key] ?? '—')}
                        </td>
                      ))}
                      <td>
                        {r.errors.length === 0
                          ? <span className="pill pill--ok">Ready</span>
                          : <span className="pill pill--bad" title={r.errors.join('; ')}>{r.errors[0]}</span>}
                        {r.mergedRowCount > 1 && (
                          <span className="pill pill--neutral" style={{ marginLeft: 6 }} title={`Rows ${r.rowNumber} in the CSV share this document number - combined into one document with the summed total.`}>
                            Merged from {r.mergedRowCount} lines
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validated.length > 200 && <p className="login-footnote" style={{ marginTop: 8 }}>Showing the first 200 of {validated.length} rows — all of them are still validated and will be imported.</p>}
            </div>
            {importError && <p className="text-[12.5px]" style={{ color: 'var(--brick)', marginTop: 10 }}>{importError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn-primary" disabled={importing || validRows.length === 0} onClick={handleImport}>
                {importing ? 'Importing…' : `Import ${validRows.length} ${def.label.toLowerCase()}`}
              </button>
              <button className="link-btn" onClick={() => setStep('map')}>Back</button>
              <button className="link-btn" onClick={resetWizard}>Start over</button>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div style={{ marginTop: 16 }}>
            <p className="text-[13px]" style={{ color: 'var(--teal)', marginBottom: 6 }}>
              ✓ Imported {result.inserted} {def.label.toLowerCase()}
              {result.newParties > 0 ? ` (${result.newParties} new ${def.partyLabel?.toLowerCase()}${result.newParties !== 1 ? 's' : ''} created)` : ''}.
              {result.skipped > 0 ? ` ${result.skipped} row(s) were skipped.` : ''}
            </p>
            <p className="login-footnote">Made a mistake? Find this import in "Recent Imports" below to undo it.</p>
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={resetWizard}>Import another file</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-header" style={{ marginBottom: 8 }}><h2>Recent Imports</h2></div>
        {loadingBatches ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <div className="table-scroll">
            <table className="ledger-table">
              <thead><tr><th>Type</th><th>File</th><th className="num">Rows</th><th>When</th><th></th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="ledger-row">
                    <td>{TARGETS[b.target_type]?.label || b.target_type}</td>
                    <td>{b.source_filename || '—'}</td>
                    <td className="num mono">{b.row_count}</td>
                    <td className="mono">{toISODate(new Date(b.created_at))}</td>
                    <td>
                      <button className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--brick)' }} disabled={undoingId === b.id} onClick={() => handleUndo(b)}>
                        <Undo2 size={12} /> {undoingId === b.id ? 'Undoing…' : 'Undo'}
                      </button>
                    </td>
                  </tr>
                ))}
                {batches.length === 0 && <tr><td colSpan={5} className="empty-state">No imports yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
