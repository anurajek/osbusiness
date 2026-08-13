import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType } from 'docx'

// Same reasoning as pdf.js: docx is a static import, not a dynamic one, so
// there's no network-fetch gap between the click and the actual file save
// that a browser could treat as no longer tied to the user's gesture and
// silently drop. Packer.toBlob() below is still async (it's real work -
// serializing the document into a zip), but that's fast local computation,
// not a network wait, so it doesn't carry the same risk a dynamic import
// does.
//
// columns: [{ label, align: 'left'|'right' }, ...]
// rows: [[cell, cell, ...], ...] - already formatted strings, in column order
export async function downloadListDocx({ title, firm, columns, rows, filename }) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map((col) => new TableCell({
      shading: { fill: 'F2F2F2' },
      children: [new Paragraph({
        alignment: col.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text: col.label, bold: true, size: 18 })],
      })],
    })),
  })

  const dataRows = rows.map((row) => new TableRow({
    children: row.map((cell, i) => new TableCell({
      children: [new Paragraph({
        alignment: columns[i]?.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text: cell != null ? String(cell) : '', size: 18 })],
      })],
    })),
  }))

  if (rows.length === 0) {
    dataRows.push(new TableRow({
      children: [new TableCell({
        columnSpan: columns.length,
        children: [new Paragraph({ children: [new TextRun({ text: 'No rows to show.', italics: true, size: 18 })] })],
      })],
    }))
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Times New Roman' } },
      },
    },
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: firm?.name || 'Report', bold: true, size: 32 })] }),
        new Paragraph({ children: [new TextRun({ text: title, size: 22, color: '666666' })], heading: HeadingLevel.HEADING_3 }),
        new Paragraph({ text: '' }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...dataRows],
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
