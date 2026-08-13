import { jsPDF } from 'jspdf'
import { toISODate } from './format'

// jsPDF's built-in standard fonts (helvetica/times/courier - all 14 of the
// PDF spec's "standard" fonts) use a legacy 1990s character encoding that
// has no glyph for the Rupee sign at all - it wasn't even proposed to
// Unicode until 2010, decades after that encoding was fixed. This isn't
// something any particular font choice fixes; none of jsPDF's built-in
// fonts can render ₹, so passing the real character through corrupts the
// text around it. "Rs." is plain ASCII, so it renders correctly
// regardless of font. Scoped to this file deliberately - the real ₹
// symbol is correct and should stay everywhere else (the app itself, CSV,
// Word), since those all have real Unicode font support.
const inrPdf = (n) => 'Rs. ' + Math.abs(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

// jsPDF is a static import, deliberately, even though it costs main-bundle
// size - a dynamic import() here means "click Export PDF" and the actual
// pdf.save() call are separated by an async gap (waiting for the chunk to
// load), and some browsers treat a file save that happens after that gap
// as no longer tied to the original user gesture and silently drop it.
// That's exactly the "Export PDF does nothing" bug this was rewritten to
// fix - the click handler now runs to completion, save included, in one
// synchronous pass, every time.
//
// Every document type below is split into a build*Pdf() (constructs and
// returns the jsPDF object, no side effects) plus two thin wrappers:
// download*Pdf() calls .save() on it, preview*Pdf() returns a blob: URL
// for showing it inline (see PdfPreviewModal.jsx) - both render from the
// exact same drawing code, so a preview is never at risk of looking
// different from what actually gets downloaded.

function renderHeader(pdf, { firm, pageWidth, margin, y }) {
  pdf.setFont('times', 'bold')
  pdf.setFontSize(16)
  pdf.text(firm.name || 'Your Firm', pageWidth - margin, y + 14, { align: 'right' })
  pdf.setFont('times', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  let hy = y + 30
  const lineH = 12
  // splitTextToSize wraps to however many lines the text actually needs at
  // this width - advancing hy by that many lines (not a fixed amount) is
  // what stops a long address from overlapping the GSTIN/phone/email lines
  // that follow it.
  if (firm.address) {
    const lines = pdf.splitTextToSize(firm.address, 260)
    pdf.text(lines, pageWidth - margin, hy, { align: 'right' })
    hy += lines.length * lineH
  }
  if (firm.gstin) { pdf.text(`GSTIN: ${firm.gstin}`, pageWidth - margin, hy, { align: 'right' }); hy += lineH }
  if (firm.phone) { pdf.text(firm.phone, pageWidth - margin, hy, { align: 'right' }); hy += lineH }
  if (firm.email) { pdf.text(firm.email, pageWidth - margin, hy, { align: 'right' }); hy += lineH }

  // The divider line sits below whichever is taller - the logo (fixed 48pt
  // max height) on the left, or the text block on the right, which can now
  // grow taller than one line - rather than a fixed offset that assumed
  // the text block was always short.
  const logoBottom = y + 58
  const ny = Math.max(logoBottom, hy) + 10
  pdf.setDrawColor(200)
  pdf.line(margin, ny, pageWidth - margin, ny)
  return ny + 30
}

async function renderLogo(pdf, { firm, margin, y }) {
  if (!firm.logo_url) return
  try {
    const img = await loadImage(firm.logo_url)
    const maxH = 48
    const ratio = img.width / img.height
    pdf.addImage(img, 'PNG', margin, y, maxH * ratio, maxH)
  } catch {
    // Bad/unreachable logo URL - just skip it rather than failing the
    // whole PDF over a decorative image.
  }
}

function renderPartyBlock(pdf, { party, label, margin, y }) {
  pdf.setFont('times', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(20)
  pdf.text(label, margin, y)
  y += 14
  pdf.setFont('times', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(30)
  pdf.text(party?.name || '—', margin, y)
  y += 13
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  const lineH = 12
  if (party?.address) {
    const lines = pdf.splitTextToSize(party.address, 260)
    pdf.text(lines, margin, y)
    y += lines.length * lineH
  }
  if (party?.gstin) { pdf.text(`GSTIN: ${party.gstin}`, margin, y); y += lineH }
  if (party?.email) { pdf.text(party.email, margin, y); y += lineH }
  return y
}

function renderFooter(pdf, { firm, pageWidth, margin }) {
  if (!firm.bank_details) return
  const footerY = pdf.internal.pageSize.getHeight() - 90
  pdf.setDrawColor(220)
  pdf.line(margin, footerY, pageWidth - margin, footerY)
  pdf.setFont('times', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text('Payment Instructions', margin, footerY + 16)
  pdf.setFont('times', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(110)
  pdf.text(firm.bank_details, margin, footerY + 30, { maxWidth: pageWidth - margin * 2 })
}

// Renders a single-page, branded invoice/bill PDF. Deliberately single-
// amount, not itemized: sales_invoices/purchase_bills don't have a
// line-items table yet (each record is one total amount), so this shows
// one summary line rather than pretending to itemize something that isn't
// itemized in the data. Quotations (buildQuotePdf, below) got itemized
// line items first - see migration_quotations.sql for why.
//
// firm: { name, gstin, address, phone, email, logo_url, bank_details }
// party: { name, gstin, address, email }
// doc: { number, issued_date, due_date, amount, paid_amount, status, isSales }
async function buildDocumentPdf({ firm, party, doc }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 48

  await renderLogo(pdf, { firm, margin, y: margin })
  let y = renderHeader(pdf, { firm, pageWidth, margin, y: margin })

  // --- Title + number/dates ---
  pdf.setTextColor(20)
  pdf.setFont('times', 'bold')
  pdf.setFontSize(20)
  pdf.text(doc.docTypeLabel || (doc.isSales ? 'INVOICE' : 'BILL'), margin, y)
  pdf.setFontSize(11)
  pdf.text(doc.number || '—', pageWidth - margin, y, { align: 'right' })
  y += 22

  pdf.setFont('times', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text(`Issued: ${doc.issued_date ? toISODate(new Date(doc.issued_date)) : '—'}`, pageWidth - margin, y, { align: 'right' })
  y += 12
  if (doc.due_date) { pdf.text(`Due: ${toISODate(new Date(doc.due_date))}`, pageWidth - margin, y, { align: 'right' }); y += 12 }

  y += 14
  y = renderPartyBlock(pdf, { party, label: doc.isSales ? 'Bill To' : 'Vendor', margin, y })

  // Real itemized + tax breakdown when the import actually carried that
  // detail (see migration_itemized_tax_and_manual_status.sql) - one line
  // item, matching what a CSV import can realistically carry (one row per
  // document). Falls back to the plain single-total summary when none of
  // this was mapped, so older imports render exactly as they always have.
  const hasItemDetail = doc.itemDescription || doc.subtotal != null || doc.cgstAmount != null || doc.sgstAmount != null || doc.igstAmount != null

  y += 24
  if (hasItemDetail) {
    const colDesc = margin + 10
    const colQty = pageWidth - margin - 220
    const colRate = pageWidth - margin - 140
    const colAmt = pageWidth - margin - 10

    pdf.setDrawColor(220)
    pdf.setFillColor(245, 245, 245)
    pdf.rect(margin, y, pageWidth - margin * 2, 22, 'F')
    pdf.setFont('times', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(90)
    pdf.text('Items & Description', colDesc, y + 15)
    pdf.text('Qty', colQty, y + 15, { align: 'right' })
    pdf.text('Rate', colRate, y + 15, { align: 'right' })
    pdf.text('Amount', colAmt, y + 15, { align: 'right' })
    y += 22

    const lineAmount = doc.itemQuantity != null && doc.itemRate != null
      ? Number(doc.itemQuantity) * Number(doc.itemRate)
      : (doc.subtotal != null ? Number(doc.subtotal) : Number(doc.amount))
    pdf.setFont('times', 'normal')
    pdf.setFontSize(9.5)
    pdf.setTextColor(30)
    pdf.text(doc.itemDescription || '—', colDesc, y + 14, { maxWidth: colQty - colDesc - 20 })
    pdf.text(doc.itemQuantity != null ? String(doc.itemQuantity) : '', colQty, y + 14, { align: 'right' })
    pdf.text(doc.itemRate != null ? inrPdf(doc.itemRate) : '', colRate, y + 14, { align: 'right' })
    pdf.text(inrPdf(lineAmount), colAmt, y + 14, { align: 'right' })
    y += 24
    pdf.setDrawColor(230)
    pdf.line(margin, y, pageWidth - margin, y)
    y += 16

    const taxRows = [['Sub Total', inrPdf(doc.subtotal ?? lineAmount), false]]
    if (doc.discountAmount) taxRows.push(['Discount', `(-)${inrPdf(doc.discountAmount)}`, false])
    if (doc.cgstAmount != null) taxRows.push([`CGST${doc.cgstRate != null ? ` (${doc.cgstRate}%)` : ''}`, inrPdf(doc.cgstAmount), false])
    if (doc.sgstAmount != null) taxRows.push([`SGST${doc.sgstRate != null ? ` (${doc.sgstRate}%)` : ''}`, inrPdf(doc.sgstAmount), false])
    if (doc.igstAmount != null) taxRows.push([`IGST${doc.igstRate != null ? ` (${doc.igstRate}%)` : ''}`, inrPdf(doc.igstAmount), false])
    taxRows.push(['Total', inrPdf(doc.amount), true])

    for (const [label, value, bold] of taxRows) {
      pdf.setFont('times', bold ? 'bold' : 'normal')
      pdf.setFontSize(bold ? 11 : 9.5)
      pdf.setTextColor(bold ? 20 : 90)
      pdf.text(label, colRate, y, { align: 'left' })
      pdf.text(value, colAmt, y, { align: 'right' })
      y += bold ? 18 : 15
    }
    y += 6
  } else {
    pdf.setDrawColor(220)
    pdf.setFillColor(245, 245, 245)
    pdf.rect(margin, y, pageWidth - margin * 2, 26, 'F')
    pdf.setFont('times', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(90)
    pdf.text('Description', margin + 10, y + 17)
    pdf.text('Amount', pageWidth - margin - 10, y + 17, { align: 'right' })
    y += 26

    pdf.setFont('times', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(30)
    pdf.text(doc.isSales ? 'Goods / services rendered' : 'Goods / services received', margin + 10, y + 18)
    pdf.text(inrPdf(doc.amount), pageWidth - margin - 10, y + 18, { align: 'right' })
    y += 28
    pdf.setDrawColor(230)
    pdf.line(margin, y, pageWidth - margin, y)
    y += 14
  }

  const balance = (Number(doc.amount) || 0) - (Number(doc.paid_amount) || 0)
  const summaryRows = [
    ['Paid', inrPdf(doc.paid_amount || 0)],
    ['Balance Due', inrPdf(balance)],
  ]
  for (const [label, value] of summaryRows) {
    pdf.setFont('times', label === 'Balance Due' ? 'bold' : 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(label === 'Balance Due' ? 20 : 90)
    pdf.text(label, pageWidth - margin - 140, y, { align: 'left' })
    pdf.text(value, pageWidth - margin - 10, y, { align: 'right' })
    y += 16
  }

  y += 10
  pdf.setFont('times', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(doc.status === 'Paid' ? 30 : 150, doc.status === 'Paid' ? 130 : 40, doc.status === 'Paid' ? 90 : 40)
  pdf.text(`Status: ${doc.status}`, margin, y)

  renderFooter(pdf, { firm, pageWidth, margin })
  return pdf
}

export async function downloadDocumentPdf(args) {
  const pdf = await buildDocumentPdf(args)
  pdf.save(`${args.doc.number || (args.doc.isSales ? 'invoice' : 'bill')}.pdf`)
}

export async function previewDocumentPdf(args) {
  const pdf = await buildDocumentPdf(args)
  return { url: pdf.output('bloburl'), filename: `${args.doc.number || (args.doc.isSales ? 'invoice' : 'bill')}.pdf` }
}

// Renders a branded, itemized quotation PDF - Description/Qty/Rate/Amount
// per line, same header/party-block/footer treatment as invoices so the
// two document types look like part of the same product.
//
// quote: { number, issued_date, valid_until, status }
// lineItems: [{ description, quantity, unit_price, amount }, ...]
async function buildQuotePdf({ firm, party, quote, lineItems }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 48

  await renderLogo(pdf, { firm, margin, y: margin })
  let y = renderHeader(pdf, { firm, pageWidth, margin, y: margin })

  pdf.setTextColor(20)
  pdf.setFont('times', 'bold')
  pdf.setFontSize(20)
  pdf.text('QUOTATION', margin, y)
  pdf.setFontSize(11)
  pdf.text(quote.number || '—', pageWidth - margin, y, { align: 'right' })
  y += 22

  pdf.setFont('times', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text(`Issued: ${quote.issued_date ? toISODate(new Date(quote.issued_date)) : '—'}`, pageWidth - margin, y, { align: 'right' })
  y += 12
  if (quote.valid_until) { pdf.text(`Valid until: ${toISODate(new Date(quote.valid_until))}`, pageWidth - margin, y, { align: 'right' }); y += 12 }

  y += 14
  y = renderPartyBlock(pdf, { party, label: 'Prepared For', margin, y })

  // --- Itemized table ---
  y += 24
  const colDesc = margin + 10
  const colQty = pageWidth - margin - 220
  const colRate = pageWidth - margin - 140
  const colAmt = pageWidth - margin - 10

  pdf.setDrawColor(220)
  pdf.setFillColor(245, 245, 245)
  pdf.rect(margin, y, pageWidth - margin * 2, 22, 'F')
  pdf.setFont('times', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text('Description', colDesc, y + 15)
  pdf.text('Qty', colQty, y + 15, { align: 'right' })
  pdf.text('Rate', colRate, y + 15, { align: 'right' })
  pdf.text('Amount', colAmt, y + 15, { align: 'right' })
  y += 22

  pdf.setFont('times', 'normal')
  pdf.setFontSize(9.5)
  pdf.setTextColor(30)
  let total = 0
  const descWidth = colQty - colDesc - 20
  for (const item of lineItems || []) {
    const amount = Number(item.amount ?? (Number(item.quantity) || 0) * (Number(item.unit_price) || 0))
    total += amount
    const descLines = pdf.splitTextToSize(item.description || '—', descWidth)
    const rowH = Math.max(20, descLines.length * 12 + 6)
    pdf.text(descLines, colDesc, y + 14)
    pdf.text(String(item.quantity ?? ''), colQty, y + 14, { align: 'right' })
    pdf.text(inrPdf(item.unit_price), colRate, y + 14, { align: 'right' })
    pdf.text(inrPdf(amount), colAmt, y + 14, { align: 'right' })
    y += rowH
    pdf.setDrawColor(235)
    pdf.line(margin, y, pageWidth - margin, y)
  }
  if (!lineItems || lineItems.length === 0) {
    pdf.setTextColor(140)
    pdf.text('No line items.', colDesc, y + 14)
    y += 20
  }

  y += 18
  pdf.setFont('times', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(20)
  pdf.text('Total', colRate, y, { align: 'right' })
  pdf.text(inrPdf(total), colAmt, y, { align: 'right' })

  y += 20
  pdf.setFont('times', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text(`Status: ${quote.status}`, margin, y)

  renderFooter(pdf, { firm, pageWidth, margin })
  return pdf
}

export async function downloadQuotePdf(args) {
  const pdf = await buildQuotePdf(args)
  pdf.save(`${args.quote.number || 'quotation'}.pdf`)
}

export async function previewQuotePdf(args) {
  const pdf = await buildQuotePdf(args)
  return { url: pdf.output('bloburl'), filename: `${args.quote.number || 'quotation'}.pdf` }
}

// Renders a branded credit/debit note PDF, reusing the same header/party/
// footer treatment as invoices and quotes.
//
// note: { number, issued_date, reason, amount, status, isCreditNote, originalDocNumber }
async function buildNotePdf({ firm, party, note }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 48

  await renderLogo(pdf, { firm, margin, y: margin })
  let y = renderHeader(pdf, { firm, pageWidth, margin, y: margin })

  pdf.setTextColor(20)
  pdf.setFont('times', 'bold')
  pdf.setFontSize(20)
  pdf.text(note.isCreditNote ? 'CREDIT NOTE' : 'DEBIT NOTE', margin, y)
  pdf.setFontSize(11)
  pdf.text(note.number || '—', pageWidth - margin, y, { align: 'right' })
  y += 22

  pdf.setFont('times', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text(`Issued: ${note.issued_date ? toISODate(new Date(note.issued_date)) : '—'}`, pageWidth - margin, y, { align: 'right' })
  y += 12
  if (note.originalDocNumber) {
    pdf.text(`Ref: ${note.originalDocNumber}`, pageWidth - margin, y, { align: 'right' })
    y += 12
  }

  y += 14
  y = renderPartyBlock(pdf, { party, label: note.isCreditNote ? 'Issued To' : 'Issued By', margin, y })

  y += 24
  pdf.setDrawColor(220)
  pdf.setFillColor(245, 245, 245)
  pdf.rect(margin, y, pageWidth - margin * 2, 26, 'F')
  pdf.setFont('times', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text('Reason', margin + 10, y + 17)
  pdf.text('Amount', pageWidth - margin - 10, y + 17, { align: 'right' })
  y += 26

  pdf.setFont('times', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(30)
  const reasonWidth = pageWidth - margin * 2 - 140
  const reasonLines = pdf.splitTextToSize(note.reason || '—', reasonWidth)
  pdf.text(reasonLines, margin + 10, y + 18)
  pdf.text(inrPdf(note.amount), pageWidth - margin - 10, y + 18, { align: 'right' })
  y += Math.max(30, reasonLines.length * 12 + 16)

  y += 12
  pdf.setFont('times', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(note.status === 'refunded' ? 30 : 150, note.status === 'refunded' ? 130 : 40, note.status === 'refunded' ? 90 : 40)
  pdf.text(`Status: ${note.status === 'refunded' ? 'Refunded' : 'Open'}`, margin, y)

  renderFooter(pdf, { firm, pageWidth, margin })
  return pdf
}

export async function downloadNotePdf(args) {
  const pdf = await buildNotePdf(args)
  pdf.save(`${args.note.number || (args.note.isCreditNote ? 'credit-note' : 'debit-note')}.pdf`)
}

export async function previewNotePdf(args) {
  const pdf = await buildNotePdf(args)
  return { url: pdf.output('bloburl'), filename: `${args.note.number || (args.note.isCreditNote ? 'credit-note' : 'debit-note')}.pdf` }
}

// Renders a generic, paginated tabular report (a list of rows, not a
// single document) - used for "export this list" actions (Cash & Bank
// transactions, Receivables/Payables pending lists, etc.), as opposed to
// the per-document PDFs above. Landscape by default since these lists
// tend to be wider than a single invoice.
//
// columns: [{ label, align: 'left'|'right' }, ...]
// rows: [[cell, cell, ...], ...] - already formatted strings, in column order
function buildListPdf({ title, firm, columns, rows, orientation = 'landscape' }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 40
  const minRowH = 20
  const lineH = 11
  const headerH = 24
  const colWidth = (pageWidth - margin * 2) / columns.length
  const cellWidth = colWidth - 16
  let y = margin

  const drawPageHeader = () => {
    pdf.setFont('times', 'bold')
    pdf.setFontSize(14)
    pdf.setTextColor(20)
    pdf.text(firm?.name || 'Report', margin, y)
    pdf.setFont('times', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(90)
    pdf.text(title, pageWidth - margin, y, { align: 'right' })
    y += 20
    pdf.setDrawColor(200)
    pdf.line(margin, y, pageWidth - margin, y)
    y += 18
  }

  const drawColumnHeaders = () => {
    pdf.setFillColor(245, 245, 245)
    pdf.rect(margin, y, pageWidth - margin * 2, headerH, 'F')
    pdf.setFont('times', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(90)
    columns.forEach((col, i) => {
      const colX = margin + i * colWidth
      const x = col.align === 'right' ? colX + colWidth - 8 : colX + 8
      pdf.text(col.label, x, y + 16, { align: col.align === 'right' ? 'right' : 'left', maxWidth: cellWidth })
    })
    y += headerH
  }

  const ensureSpace = (neededH) => {
    if (y + neededH > pageHeight - margin) {
      pdf.addPage()
      y = margin
      drawPageHeader()
      drawColumnHeaders()
    }
  }

  drawPageHeader()
  drawColumnHeaders()

  pdf.setFont('times', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(30)
  rows.forEach((row, rowIndex) => {
    // Pre-compute how many lines each cell actually needs before drawing
    // or advancing y - this is the real fix for rows overlapping when a
    // long customer name wraps to two or three lines. Previously the row
    // height was a fixed 20pt regardless of how much text a cell actually
    // needed, so the next row started drawing before a wrapped cell had
    // finished, visually merging the two.
    // List-export rows arrive as already-formatted strings built by
    // whichever screen called downloadListPdf (Receivables, Payables,
    // Sales, Cash & Bank, and many more) - most of them using the app's
    // normal inr() formatter with the real ₹ symbol, since that's correct
    // everywhere except here. Sanitized here too, at the point of
    // measuring/drawing, rather than chasing down every screen that
    // builds a rows array, since this is the one place all of them funnel
    // through anyway.
    const cellLines = columns.map((col, i) => {
      const text = row[i] != null ? String(row[i]).replace(/₹/g, 'Rs. ') : ''
      return pdf.splitTextToSize(text, cellWidth)
    })
    const maxLines = Math.max(1, ...cellLines.map((lines) => lines.length))
    const thisRowH = Math.max(minRowH, maxLines * lineH + 9)

    ensureSpace(thisRowH)
    if (rowIndex % 2 === 1) {
      pdf.setFillColor(250, 250, 250)
      pdf.rect(margin, y, pageWidth - margin * 2, thisRowH, 'F')
    }
    columns.forEach((col, i) => {
      const colX = margin + i * colWidth
      const x = col.align === 'right' ? colX + colWidth - 8 : colX + 8
      pdf.text(cellLines[i], x, y + 14, { align: col.align === 'right' ? 'right' : 'left' })
    })
    y += thisRowH
  })

  if (rows.length === 0) {
    pdf.setTextColor(140)
    pdf.text('No rows to show.', margin + 8, y + 14)
  }

  return pdf
}

export function downloadListPdf(args) {
  const pdf = buildListPdf(args)
  const filename = args.filename
  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

export function previewListPdf(args) {
  const pdf = buildListPdf(args)
  const filename = args.filename
  return { url: pdf.output('bloburl'), filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf` }
}

// Maps a raw DB row's snake_case item/tax columns to the camelCase doc.*
// fields buildDocumentPdf expects - shared so every screen that previews
// an invoice/bill/PI does this mapping identically, rather than each
// hand-rolling the same conversion.
export function itemTaxFieldsFromRow(row) {
  return {
    itemDescription: row.item_description,
    itemQuantity: row.item_quantity,
    itemRate: row.item_rate,
    subtotal: row.subtotal,
    discountAmount: row.discount_amount,
    cgstRate: row.cgst_rate,
    cgstAmount: row.cgst_amount,
    sgstRate: row.sgst_rate,
    sgstAmount: row.sgst_amount,
    igstRate: row.igst_rate,
    igstAmount: row.igst_amount,
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}
