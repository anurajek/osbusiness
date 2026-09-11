// Imperative "something good just happened" effect - call celebrate(text)
// from anywhere (marking an invoice Paid, resolving a task, sending an
// invite) and it drops a brief confetti burst + toast onto the page, then
// cleans itself up. No canvas, no animation library - just DOM nodes
// using the CSS in index.css (.confetti-piece/.celebration-toast), so it
// costs nothing to keep around and never touches the color palette (pulls
// from the same --brass/--teal/--brick variables everything else uses).
const CONFETTI_COLORS = ['var(--brass)', 'var(--teal)', 'var(--brick)', 'var(--paper)']

export function celebrate(message, { confetti = true } = {}) {
  if (typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) confetti = false

  if (confetti) {
    const originX = window.innerWidth / 2
    const originY = Math.min(window.innerHeight * 0.35, 220)
    const pieceCount = 18
    for (let i = 0; i < pieceCount; i++) {
      const piece = document.createElement('div')
      piece.className = 'confetti-piece'
      const angle = (Math.random() - 0.5) * 200 // spread left/right
      const drift = Math.round(Math.cos((angle * Math.PI) / 180) * 90)
      piece.style.left = `${originX + (Math.random() - 0.5) * 60}px`
      piece.style.top = `${originY}px`
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
      piece.style.setProperty('--drift', `${drift}px`)
      piece.style.setProperty('--spin', `${Math.round(Math.random() * 360 + 180)}deg`)
      piece.style.animationDelay = `${Math.random() * 0.12}s`
      document.body.appendChild(piece)
      setTimeout(() => piece.remove(), 1100)
    }
  }

  if (message) {
    const existing = document.querySelector('.celebration-toast')
    if (existing) existing.remove()
    const toast = document.createElement('div')
    toast.className = 'celebration-toast'
    toast.textContent = message
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 2200)
  }
}
