import { inr, toISODate } from './format'

// jsPDF is dynamically imported below, not at module top-level, so it (and
// its own optional html2canvas/dompurify dependencies, which this file
// never actually uses) don't inflate the app's main bundle - they load as
// a separate chunk only when someone actually clicks "Download PDF".

function renderHeader(pdf, { firm, pageWidth, margin, y }) {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text(firm.name || 'Your Firm', pageWidth - margin, y + 14, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  let hy = y + 30
  if (firm.address) { pdf.text(firm.address, pageWidth - margin, hy, { align: 'right', maxWidth: 260 }); hy += 12 }
  if (firm.gstin) { pdf.text(`GSTIN: ${firm.gstin}`, pageWidth - margin, hy, { align: 'right' }); hy += 12 }
  if (firm.phone) { pdf.text(firm.phone, pageWidth - margin, hy, { align: 'right' }); hy += 12 }
  if (firm.email) { pdf.text(firm.email, pageWidth - margin, hy, { align: 'right' }); hy += 12 }

  let ny = y + 70
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
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(20)
  pdf.text(label, margin, y)
  y += 14
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(30)
  pdf.text(party?.name || '—', margin, y)
  y += 13
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  if (party?.address) { pdf.text(party.address, margin, y, { maxWidth: 260 }); y += 12 }
  if (party?.gstin) { pdf.text(`GSTIN: ${party.gstin}`, margin, y); y += 12 }
  if (party?.email) { pdf.text(party.email, margin, y); y += 12 }
  return y
}

function renderFooter(pdf, { firm, pageWidth, margin }) {
  if (!firm.bank_details) return
  const footerY = pdf.internal.pageSize.getHeight() - 90
  pdf.setDrawColor(220)
  pdf.line(margin, footerY, pageWidth - margin, footerY)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text('Payment Instructions', margin, footerY + 16)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(110)
  pdf.text(firm.bank_details, margin, footerY + 30, { maxWidth: pageWidth - margin * 2 })
}

// Renders a single-page, branded invoice/bill PDF and triggers a download.
// Deliberately single-amount, not itemized: sales_invoices/purchase_bills
// don't have a line-items table yet (each record is one total amount), so
// this shows one summary line rather than pretending to itemize something
// that isn't itemized in the data. Quotations (downloadQuotePdf, below) got
// itemized line items first - see migration_quotations.sql for why.
//
// firm: { name, gstin, address, phone, email, logo_url, bank_details }
// party: { name, gstin, address, email }
// doc: { number, issued_date, due_date, amount, paid_amount, status, isSales }
export async function downloadDocumentPdf({ firm, party, doc }) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 48

  await renderLogo(pdf, { firm, margin, y: margin })
  let y = renderHeader(pdf, { firm, pageWidth, margin, y: margin })

  // --- Title + number/dates ---
  pdf.setTextColor(20)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)
  pdf.text(doc.isSales ? 'INVOICE' : 'BILL', margin, y)
  pdf.setFontSize(11)
  pdf.text(doc.number || '—', pageWidth - margin, y, { align: 'right' })
  y += 22

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text(`Issued: ${doc.issued_date ? toISODate(new Date(doc.issued_date)) : '—'}`, pageWidth - margin, y, { align: 'right' })
  y += 12
  if (doc.due_date) { pdf.text(`Due: ${toISODate(new Date(doc.due_date))}`, pageWidth - margin, y, { align: 'right' }); y += 12 }

  y += 14
  y = renderPartyBlock(pdf, { party, label: doc.isSales ? 'Bill To' : 'Vendor', margin, y })

  // --- Amount summary table ---
  y += 24
  pdf.setDrawColor(220)
  pdf.setFillColor(245, 245, 245)
  pdf.rect(margin, y, pageWidth - margin * 2, 26, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text('Description', margin + 10, y + 17)
  pdf.text('Amount', pageWidth - margin - 10, y + 17, { align: 'right' })
  y += 26

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(30)
  pdf.text(doc.isSales ? 'Goods / services rendered' : 'Goods / services received', margin + 10, y + 18)
  pdf.text(inr(doc.amount), pageWidth - margin - 10, y + 18, { align: 'right' })
  y += 28
  pdf.setDrawColor(230)
  pdf.line(margin, y, pageWidth - margin, y)

  const balance = (Number(doc.amount) || 0) - (Number(doc.paid_amount) || 0)
  const summaryRows = [
    ['Total', inr(doc.amount)],
    ['Paid', inr(doc.paid_amount || 0)],
    ['Balance Due', inr(balance)],
  ]
  y += 14
  for (const [label, value] of summaryRows) {
    pdf.setFont('helvetica', label === 'Balance Due' ? 'bold' : 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(label === 'Balance Due' ? 20 : 90)
    pdf.text(label, pageWidth - margin - 140, y, { align: 'left' })
    pdf.text(value, pageWidth - margin - 10, y, { align: 'right' })
    y += 16
  }

  y += 10
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(doc.status === 'Paid' ? 30 : 150, doc.status === 'Paid' ? 130 : 40, doc.status === 'Paid' ? 90 : 40)
  pdf.text(`Status: ${doc.status}`, margin, y)

  renderFooter(pdf, { firm, pageWidth, margin })
  pdf.save(`${doc.number || (doc.isSales ? 'invoice' : 'bill')}.pdf`)
}

// Renders a branded, itemized quotation PDF - Description/Qty/Rate/Amount
// per line, same header/party-block/footer treatment as invoices so the
// two document types look like part of the same product.
//
// quote: { number, issued_date, valid_until, status }
// lineItems: [{ description, quantity, unit_price, amount }, ...]
export async function downloadQuotePdf({ firm, party, quote, lineItems }) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 48

  await renderLogo(pdf, { firm, margin, y: margin })
  let y = renderHeader(pdf, { firm, pageWidth, margin, y: margin })

  pdf.setTextColor(20)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)
  pdf.text('QUOTATION', margin, y)
  pdf.setFontSize(11)
  pdf.text(quote.number || '—', pageWidth - margin, y, { align: 'right' })
  y += 22

  pdf.setFont('helvetica', 'normal')
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
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text('Description', colDesc, y + 15)
  pdf.text('Qty', colQty, y + 15, { align: 'right' })
  pdf.text('Rate', colRate, y + 15, { align: 'right' })
  pdf.text('Amount', colAmt, y + 15, { align: 'right' })
  y += 22

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9.5)
  pdf.setTextColor(30)
  let total = 0
  for (const item of lineItems || []) {
    const amount = Number(item.amount ?? (Number(item.quantity) || 0) * (Number(item.unit_price) || 0))
    total += amount
    const rowH = 20
    pdf.text(item.description || '—', colDesc, y + 14, { maxWidth: colQty - colDesc - 20 })
    pdf.text(String(item.quantity ?? ''), colQty, y + 14, { align: 'right' })
    pdf.text(inr(item.unit_price), colRate, y + 14, { align: 'right' })
    pdf.text(inr(amount), colAmt, y + 14, { align: 'right' })
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
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(20)
  pdf.text('Total', colRate, y, { align: 'right' })
  pdf.text(inr(total), colAmt, y, { align: 'right' })

  y += 20
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text(`Status: ${quote.status}`, margin, y)

  renderFooter(pdf, { firm, pageWidth, margin })
  pdf.save(`${quote.number || 'quotation'}.pdf`)
}

// Renders a branded credit/debit note PDF, reusing the same header/party/
// footer treatment as invoices and quotes.
//
// note: { number, issued_date, reason, amount, status, isCreditNote, originalDocNumber }
export async function downloadNotePdf({ firm, party, note }) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 48

  await renderLogo(pdf, { firm, margin, y: margin })
  let y = renderHeader(pdf, { firm, pageWidth, margin, y: margin })

  pdf.setTextColor(20)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)
  pdf.text(note.isCreditNote ? 'CREDIT NOTE' : 'DEBIT NOTE', margin, y)
  pdf.setFontSize(11)
  pdf.text(note.number || '—', pageWidth - margin, y, { align: 'right' })
  y += 22

  pdf.setFont('helvetica', 'normal')
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
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  pdf.text('Reason', margin + 10, y + 17)
  pdf.text('Amount', pageWidth - margin - 10, y + 17, { align: 'right' })
  y += 26

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(30)
  pdf.text(note.reason || '—', margin + 10, y + 18, { maxWidth: pageWidth - margin * 2 - 140 })
  pdf.text(inr(note.amount), pageWidth - margin - 10, y + 18, { align: 'right' })
  y += 30

  y += 12
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(note.status === 'refunded' ? 30 : 150, note.status === 'refunded' ? 130 : 40, note.status === 'refunded' ? 90 : 40)
  pdf.text(`Status: ${note.status === 'refunded' ? 'Refunded' : 'Open'}`, margin, y)

  renderFooter(pdf, { firm, pageWidth, margin })
  pdf.save(`${note.number || (note.isCreditNote ? 'credit-note' : 'debit-note')}.pdf`)
}

// Renders a generic, paginated tabular report (a list of rows, not a
// single document) - used for "export this list" actions (Cash & Bank
// transactions, Receivables/Payables pending lists, etc.), as opposed to
// the per-document PDFs above. Landscape by default since these lists
// tend to be wider than a single invoice.
//
// columns: [{ label, align: 'left'|'right' }, ...]
// rows: [[cell, cell, ...], ...] - already formatted strings, in column order
export async function downloadListPdf({ title, firm, columns, rows, filename, orientation = 'landscape' }) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 40
  const rowH = 20
  const headerH = 24
  const colWidth = (pageWidth - margin * 2) / columns.length
  let y = margin

  const drawPageHeader = () => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.setTextColor(20)
    pdf.text(firm?.name || 'Report', margin, y)
    pdf.setFont('helvetica', 'normal')
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
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(90)
    columns.forEach((col, i) => {
      const colX = margin + i * colWidth
      const x = col.align === 'right' ? colX + colWidth - 8 : colX + 8
      pdf.text(col.label, x, y + 16, { align: col.align === 'right' ? 'right' : 'left', maxWidth: colWidth - 16 })
    })
    y += headerH
  }

  const ensureSpace = () => {
    if (y + rowH > pageHeight - margin) {
      pdf.addPage()
      y = margin
      drawPageHeader()
      drawColumnHeaders()
    }
  }

  drawPageHeader()
  drawColumnHeaders()

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(30)
  rows.forEach((row, rowIndex) => {
    ensureSpace()
    if (rowIndex % 2 === 1) {
      pdf.setFillColor(250, 250, 250)
      pdf.rect(margin, y, pageWidth - margin * 2, rowH, 'F')
    }
    columns.forEach((col, i) => {
      const colX = margin + i * colWidth
      const x = col.align === 'right' ? colX + colWidth - 8 : colX + 8
      const text = row[i] != null ? String(row[i]) : ''
      pdf.text(text, x, y + 14, { align: col.align === 'right' ? 'right' : 'left', maxWidth: colWidth - 16 })
    })
    y += rowH
  })

  if (rows.length === 0) {
    pdf.setTextColor(140)
    pdf.text('No rows to show.', margin + 8, y + 14)
  }

  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
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
