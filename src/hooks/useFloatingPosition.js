import { useCallback, useLayoutEffect, useState } from 'react'

// Every dropdown/flyout in the app (Dropdown, DatePicker, the Actions…
// menu, Assign/Remind/@mention, the header's Profile/Firm/Notification
// menus) used to open as position:absolute inside its own trigger's
// wrapper - fine most of the time, but a wrapper that lives inside a
// scrollable table (overflow-y on .table-scroll) clips anything
// absolutely positioned past its own boundary.
//
// This computes position:fixed coordinates instead (meant to be used
// with a portal - see FloatingPanel in ui.jsx - so the menu escapes
// every ancestor's overflow entirely). Flips to open upward when there
// isn't room below and there's more room above, and left/right based on
// actual available width too - fully free positioning in whichever
// direction actually has room, the same way a browser's native <select>
// or a spreadsheet's cell-comment popup behaves.
//
// Two-pass, not a guess: an earlier version decided up-vs-down using an
// *estimated* menu height (item count x a guessed row height). Wrong
// estimate, wrong decision - explains exactly the bug this replaced:
// worked in some spots by coincidence, broke at the real edge, and
// "fixed itself" on scroll only because scrolling re-ran the same flawed
// guess with different numbers that happened to work out that time.
// This version renders the panel invisibly first (still fully laid out,
// so the browser computes its *real* size), measures that with
// getBoundingClientRect, and only then computes and applies the real
// position - the same measure-then-place approach any serious popover
// library uses, and the only way to never be wrong about how tall the
// content actually is.
export function useFloatingPosition(triggerRef, panelRef, open, { menuWidth = 220, align = 'left' } = {}) {
  const [coords, setCoords] = useState(null)
  const [phase, setPhase] = useState('closed') // 'closed' | 'measuring' | 'positioned'

  const recalc = useCallback(() => {
    const el = triggerRef.current
    const panel = panelRef.current
    if (!el || !panel) return
    const triggerRect = el.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const gap = 4

    const spaceBelow = window.innerHeight - triggerRect.bottom - gap
    const spaceAbove = triggerRect.top - gap
    const openUp = panelRect.height > spaceBelow && spaceAbove > spaceBelow

    const width = Math.max(menuWidth, triggerRect.width, panelRect.width)
    const spaceRight = window.innerWidth - triggerRect.left
    // Free left/right: prefer whichever side actually fits the panel's
    // real width, falling back to the requested align if both/neither
    // technically fit (then clamped to stay on-screen regardless).
    const fitsLeft = spaceRight >= width
    const fitsRight = triggerRect.right >= width
    const openRight = align === 'right' ? fitsRight || !fitsLeft : !fitsLeft && fitsRight
    let left = openRight ? triggerRect.right - width : triggerRect.left
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))

    setCoords({
      left, width,
      top: openUp ? undefined : triggerRect.bottom + gap,
      bottom: openUp ? window.innerHeight - triggerRect.top + gap : undefined,
      maxHeight: Math.max(120, (openUp ? spaceAbove : spaceBelow)),
    })
    setPhase('positioned')
  }, [triggerRef, panelRef, menuWidth, align])

  useLayoutEffect(() => {
    if (!open) { setCoords(null); setPhase('closed'); return undefined }
    // First pass: lay the panel out invisibly (see FloatingPanel's
    // 'measuring' style) so its real size exists to measure at all.
    setPhase('measuring')
    return undefined
  }, [open])

  useLayoutEffect(() => {
    if (phase !== 'measuring') return undefined
    recalc()
  }, [phase, recalc])

  useLayoutEffect(() => {
    if (phase !== 'positioned') return undefined
    window.addEventListener('resize', recalc)
    window.addEventListener('scroll', recalc, true)
    return () => {
      window.removeEventListener('resize', recalc)
      window.removeEventListener('scroll', recalc, true)
    }
  }, [phase, recalc])

  return { coords, phase }
}
