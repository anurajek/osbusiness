import { useState, useCallback } from 'react'

const STORAGE_KEY = 'finopilo-nav-layout'

// Same persistence pattern as useTheme.js - 'sidebar' (the original,
// default layout) or 'topbar' (module nav moved to a horizontal bar under
// the header, no left-hand column). Purely a layout preference - doesn't
// affect which modules a person can see (that's still role/permissions),
// only where the nav sits.
export function useLayoutPref() {
  const [navLayout, setNavLayout] = useState(() => {
    if (typeof window === 'undefined') return 'sidebar'
    return localStorage.getItem(STORAGE_KEY) || 'sidebar'
  })

  const toggleNavLayout = useCallback(() => {
    setNavLayout((l) => {
      const next = l === 'sidebar' ? 'topbar' : 'sidebar'
      localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return { navLayout, toggleNavLayout }
}
