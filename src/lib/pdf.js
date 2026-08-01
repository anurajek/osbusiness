import { inr, toISODate } from './format'

// jsPDF is dynamically imported below, not at module top-level, so it (and
// its own optional html2canvas/dompurify dependencies, which this file
// never actually uses) don't inflate the app's main bundle - they load as
// a separate chunk only when someone actually clicks "Download PDF".

// Renders a single-page, branded invoice/bill PDF and triggers a download.
// Deliberately single-amount, not itemized: sales_invoices/purchase_bills
// don't have a line-items table yet (each record is one total amount), so
// this shows one summary line rather than pretending to itemize something
// that isn't itemized in the data. Multi-line invoicing is a bigger, separate
// schema change - see README's General Ledger/Sales section for the plan.
//
// firm: { name, gstin, address, phone, email, logo_url, bank_details }
// party: { name, gstin, address, email }
// doc: { number, issued_date, due_date, amount, paid_amount, status, isSales }
export async function downloadDocumentPdf({ firm, party, doc }) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 48
  let y = margin

  // --- Header: logo (if any) + firm identity ---
  if (firm.logo_url) {
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

  y += 70
  pdf.setDrawColor(200)
  pdf.line(margin, y, pageWidth - margin, y)
  y += 30

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

  // --- Bill To / Vendor ---
  y += 14
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(20)
  pdf.text(doc.isSales ? 'Bill To' : 'Vendor', margin, y)
  y += 14
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(party?.name || '—', margin, y)
  y += 13
  pdf.setFontSize(9)
  pdf.setTextColor(90)
  if (party?.address) { pdf.text(party.address, margin, y, { maxWidth: 260 }); y += 12 }
  if (party?.gstin) { pdf.text(`GSTIN: ${party.gstin}`, margin, y); y += 12 }
  if (party?.email) { pdf.text(party.email, margin, y); y += 12 }

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
  const rowH = 28
  pdf.text(doc.isSales ? 'Goods / services rendered' : 'Goods / services received', margin + 10, y + 18)
  pdf.text(inr(doc.amount), pageWidth - margin - 10, y + 18, { align: 'right' })
  y += rowH
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

  // --- Status stamp ---
  y += 10
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(doc.status === 'Paid' ? 30 : 150, doc.status === 'Paid' ? 130 : 40, doc.status === 'Paid' ? 90 : 40)
  pdf.text(`Status: ${doc.status}`, margin, y)

  // --- Payment instructions footer ---
  if (firm.bank_details) {
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

  pdf.save(`${doc.number || (doc.isSales ? 'invoice' : 'bill')}.pdf`)
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
