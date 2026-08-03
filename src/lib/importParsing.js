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

// Guesses which uploaded column matches each target field by normalizing
// both to lowercase-alphanumeric-only and checking for a substring match in
// either direction. Good enough to save re-picking every column by hand for
// an obviously-named export (e.g. "Customer Name" -> customer_name), while
// every guess stays fully editable before anything is imported.
export function guessMapping(headers, fields) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const mapping = {}
  for (const field of fields) {
    const fieldNorm = normalize(field.label)
    const match = headers.find((h) => {
      const hNorm = normalize(h)
      return hNorm === fieldNorm || hNorm.includes(fieldNorm) || fieldNorm.includes(hNorm)
    })
    mapping[field.key] = match || ''
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
