import { useEffect } from 'react'
import { X, Download } from 'lucide-react'

// Shows a PDF inline in the browser's own PDF viewer, via an iframe pointed
// at a blob: URL - this is the actual generated document, not an HTML
// approximation of it, so there's no risk of the preview looking different
// from what downloads. The caller owns creating/revoking the blob URL
// (see previewDocumentPdf/previewListPdf/etc. in lib/pdf.js) - this
// component just displays whatever URL it's given and revokes it on close.
export default function PdfPreviewModal({ url, filename, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-large__header">
          <h2>{filename}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button className="link-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={handleDownload}>
              <Download size={14} /> Download
            </button>
            <button className="drawer__close" onClick={onClose} aria-label="Close preview">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="modal-large__body">
          <iframe src={url} title={filename} />
        </div>
      </div>
    </div>
  )
}
