// A plain client-side CSV export, no library needed - CSV opens natively
// in Excel, Google Sheets, and every spreadsheet tool, which is why this
// app's exports use it instead of writing a real .xlsx file. See the
// import feature's README section for why: the standard npm package for
// writing/reading .xlsx has a known high-severity vulnerability with no
// fix available, so this app avoids it entirely on both the import and
// export side.
export function downloadCsv(filename, headers, rows) {
  const escape = (val) => {
    const s = String(val ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  // A leading BOM so Excel (which otherwise guesses the wrong encoding for
  // non-ASCII characters like the ₹ symbol) opens this as UTF-8 correctly.
  const csv = '\uFEFF' + lines.join('\r\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
