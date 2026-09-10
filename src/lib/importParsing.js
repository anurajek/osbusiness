// papaparse is dynamically imported inside parseCsvFile, not at module
// top-level, so it doesn't add to the app's normal page-load bundle - same
// lazy-loading approach used for jspdf, since importing is an occasional
// action, not something every page load needs.

export async function parseCsvFile(file) {
  const Papa = (await import('papaparse')).default
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta.fields || []
        resolve({ headers, rows: results.data })
      },
      error: reject,
    })
  })
}

// Guesses which uploaded column matches each target field. Two passes:
// an exact match first (after normalizing to lowercase alphanumeric
// tokens), then a looser "every word in the shorter phrase appears in
// the longer one" match - but only for candidates with 2+ words. A
// single generic word like "Rate" or "Discount" would otherwise happily
// match totally wrong columns like "Exchange Rate" or "Discount Type"
// (both genuinely present in real exports) just because the word
// appears somewhere in them - real, wrong guesses that would go
// unnoticed until the imported numbers came out wrong. Each header can
// only be claimed by one field, so two FinoPilo fields never end up
// silently pointing at the same column.
//
// FIELD_SYNONYMS covers the common cases where an export's own wording
// diverges from FinoPilo's field labels entirely (Zoho calls the PI/
// invoice date "Estimate Date"/"Invoice Date", the number "Estimate
// Number", the document total just "Total", not "Amount") - tried in
// order, first candidate that matches anything wins.
const FIELD_SYNONYMS = {
  doc_no: ['estimate number', 'invoice number', 'bill number', 'reference number', 'document number'],
  issued_date: ['estimate date', 'invoice date', 'bill date', 'document date'],
  due_date: ['expiry date', 'payment due date', 'due date'],
  amount: ['total'],
  item_description: ['item name', 'item desc'],
  item_rate: ['item price', 'unit price', 'price'],
  // "Item Total" listed ahead of the field's own label on purpose - a real
  // gotcha found importing an actual Zoho Estimates export: Zoho's own
  // "SubTotal" column is document-level (the same value repeated on every
  // line of a multi-line document, same as "Total"), while "Item Total" is
  // the genuinely per-line pre-tax amount. FinoPilo's Sub Total field is
  // summed across a merged group's lines to reconstruct the document
  // subtotal (see SUMMABLE_ITEM_FIELDS below) - mapping it to Zoho's
  // SubTotal would sum that same repeated document total once per line
  // instead of once total, inflating it by the line count. "Item Total"
  // is tried first so that's what actually gets picked.
  subtotal: ['item total'],
  discount_amount: ['discount amount', 'item discount'],
  cgst_amount: ['cgst'],
  sgst_amount: ['sgst'],
  igst_amount: ['igst'],
}

function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
}

export function guessMapping(headers, fields) {
  const headerInfo = headers.map((h) => ({ header: h, tokens: tokenize(h) }))
  const used = new Set()

  const findMatch = (candidate) => {
    const candTokens = tokenize(candidate)
    const candKey = candTokens.join('')
    // Pass 1: exact match, whole phrase.
    let hit = headerInfo.find((h) => !used.has(h.header) && h.tokens.join('') === candKey)
    if (hit) return hit.header
    // Pass 2: every word of the shorter phrase appears in the longer one -
    // skipped for single-word candidates to avoid the false-positive risk
    // described above.
    if (candTokens.length < 2) return null
    hit = headerInfo.find((h) => {
      if (used.has(h.header) || h.tokens.length < 2) return false
      const [shorter, longer] = candTokens.length <= h.tokens.length ? [candTokens, h.tokens] : [h.tokens, candTokens]
      return shorter.every((t) => longer.includes(t))
    })
    return hit ? hit.header : null
  }

  const mapping = {}
  for (const field of fields) {
    // Synonyms tried before the field's own label, not after - a synonym
    // only exists here because it's a *better, more specific* match for a
    // known export-format gotcha (see the subtotal/"Item Total" comment
    // above); trying the plain label first would let a same-named-but-
    // wrong-level column (like Zoho's own "SubTotal") win the exact-match
    // check before the synonym ever got a chance to be tried at all.
    const candidates = [...(FIELD_SYNONYMS[field.key] || []), field.label]
    let match = null
    for (const c of candidates) {
      match = findMatch(c)
      if (match) break
    }
    mapping[field.key] = match || ''
    if (match) used.add(match)
  }
  return mapping
}

// Tally/Zoho/Excel exports use all kinds of date formats depending on
// region and export settings - this tries the common ones rather than
// assuming ISO. Returns an ISO "YYYY-MM-DD" string, or null if unparseable.
export function parseFlexibleDate(value) {
  if (!value) return null
  const s = String(value).trim()
  if (!s) return null

  // ISO: 2026-01-15
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return isoFrom(m[1], m[2], m[3])

  // DD/MM/YYYY or DD-MM-YYYY (most common in Indian exports)
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return isoFrom(m[3], m[2], m[1])

  // DD/MM/YY or DD-MM-YY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/)
  if (m) return isoFrom(`20${m[3]}`, m[2], m[1])

  // Fall back to whatever the browser's Date parser can make of it
  // (handles things like "15 Jan 2026", "Jan 15, 2026").
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)

  return null
}

function isoFrom(y, mo, d) {
  const year = String(y).padStart(4, '0')
  const month = String(mo).padStart(2, '0')
  const day = String(d).padStart(2, '0')
  const date = new Date(`${year}-${month}-${day}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return `${year}-${month}-${day}`
}

// Strips currency symbols, thousands separators, and stray whitespace
// before parsing - handles "₹1,23,456.00", "Rs. 5,000", "1234.5", etc.
export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return Number.isNaN(n) ? null : n
}
