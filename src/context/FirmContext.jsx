import { createContext, useContext, useMemo, useState, useEffect } from 'react'

const FirmContext = createContext(null)

export function FirmProvider({ memberships, refreshMemberships, children }) {
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
    // This user's own firm_members row id for the selected firm - lets a
    // screen tell "my own membership row" apart from everyone else's (e.g.
    // to stop someone removing themselves from the member list).
    membershipId: current?.id ?? null,
    refreshMemberships,
  }), [memberships, firmId, current, refreshMemberships])

  return <FirmContext.Provider value={value}>{children}</FirmContext.Provider>
}

export function useFirm() {
  const ctx = useContext(FirmContext)
  if (!ctx) throw new Error('useFirm must be used inside a FirmProvider')
  return ctx
}
