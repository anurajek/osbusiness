import { useCallback, useLayoutEffect, useState } from 'react'

// Every dropdown/flyout in the app (Dropdown, DatePicker, the Actions…
// menu, Assign/Remind/@mention, the header's Profile/Firm/Notification
// menus) used to open as position:absolute inside its own trigger's
// wrapper - fine most of the time, but a wrapper that lives inside a
// scrollable table (overflow-y on .table-scroll) clips anything
// absolutely positioned past its own boundary. A short list near the
// bottom of a table had nowhere to actually show the menu, no matter how
// tall the browser window was - the menu was being cut off by the
// table's own scroll box, not the screen.
//
// This computes position:fixed coordinates instead (meant to be used
// with a portal - see FloatingPanel in ui.jsx - so the menu escapes
// every ancestor's overflow entirely, the same way a browser's native
// <select> or a spreadsheet's cell-comment popup always renders on top
// of everything regardless of where the cell sits). Flips to open
// upward when there isn't room below and there's more room above
// (exactly the "no space at the bottom, opens above instead" behavior
// asked for) - measured against the *actual* trigger position on every
// open, resize, and scroll, not a one-time guess.
export function useFloatingPosition(triggerRef, open, { menuWidth = 220, menuHeight = 260, align = 'left' } = {}) {
  const [coords, setCoords] = useState(null)

  const recalc = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const gap = 4
    const spaceBelow = window.innerHeight - rect.bottom - gap
    const spaceAbove = rect.top - gap
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow

    const width = Math.max(menuWidth, rect.width)
    let left = align === 'right' ? rect.right - width : rect.left
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))

    setCoords({
      left,
      width,
      top: openUp ? undefined : rect.bottom + gap,
      bottom: openUp ? window.innerHeight - rect.top + gap : undefined,
      maxHeight: Math.max(120, (openUp ? spaceAbove : spaceBelow)),
    })
  }, [triggerRef, menuWidth, menuHeight, align])

  useLayoutEffect(() => {
    if (!open) { setCoords(null); return undefined }
    recalc()
    window.addEventListener('resize', recalc)
    window.addEventListener('scroll', recalc, true)
    return () => {
      window.removeEventListener('resize', recalc)
      window.removeEventListener('scroll', recalc, true)
    }
  }, [open, recalc])

  return coords
}
