import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'finopilo-theme'

// Called once at the very top of App.jsx, deliberately before any
// auth-state check - the effect that sets data-theme on <html> needs to
// run for the login/signup screens too, not just the authenticated app,
// so the whole product respects a saved preference from the first paint
// rather than always starting dark and flashing to light for a signed-out
// visitor.
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return localStorage.getItem(STORAGE_KEY) || 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggleTheme }
}
