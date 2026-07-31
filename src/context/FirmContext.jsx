import { createContext, useContext, useMemo, useState, useEffect } from 'react'

const FirmContext = createContext(null)

export function FirmProvider({ memberships, children }) {
  const [firmId, setFirmId] = useState(memberships[0]?.firm_id ?? null)

  // If memberships change (e.g. after a fresh login) and the previously
  // selected firm is no longer in the list, fall back to the first one.
  useEffect(() => {
    if (!memberships.some((m) => m.firm_id === firmId)) {
      setFirmId(memberships[0]?.firm_id ?? null)
    }
  }, [memberships, firmId])

  const current = useMemo(
    () => memberships.find((m) => m.firm_id === firmId) ?? null,
    [memberships, firmId]
  )

  const value = useMemo(() => ({
    memberships,
    firmId,
    setFirmId,
    firm: current?.firms ?? null,
    role: current?.role ?? null,
    permissions: current?.permissions ?? {},
  }), [memberships, firmId, current])

  return <FirmContext.Provider value={value}>{children}</FirmContext.Provider>
}

export function useFirm() {
  const ctx = useContext(FirmContext)
  if (!ctx) throw new Error('useFirm must be used inside a FirmProvider')
  return ctx
}
