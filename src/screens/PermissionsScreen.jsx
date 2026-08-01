import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { SectionHeader } from '../components/ui'

const MODULES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'sales', label: 'Sales' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'arap', label: 'AR / AP' },
  { key: 'cashbank', label: 'Cash & Bank' },
  { key: 'ledger', label: 'Ledger' },
]

const ROLES = ['Accountant', 'Viewer']
const OWNER_PERMISSIONS = { dashboard: true, sales: true, purchases: true, arap: true, cashbank: true, ledger: true, permissions: true }
const DEFAULT_PERMISSIONS = { dashboard: true, sales: true, purchases: true, arap: true, cashbank: true, ledger: false, permissions: false }

export default function PermissionsScreen() {
  const { firmId, role: myRole, firm, membershipId, refreshMemberships } = useFirm()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)

  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('Accountant')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [inviteSuccess, setInviteSuccess] = useState(null)

  const [firmName, setFirmName] = useState(firm?.name ?? '')
  const [firmGstin, setFirmGstin] = useState(firm?.gstin ?? '')
  const [savingFirm, setSavingFirm] = useState(false)
  const [firmError, setFirmError] = useState(null)
  const [firmSuccess, setFirmSuccess] = useState(null)
  const [editingFirm, setEditingFirm] = useState(false)

  // Keep the form in sync if the selected firm changes (multi-firm users)
  // or after a save refreshes `firm` with the latest saved values.
  useEffect(() => {
    setFirmName(firm?.name ?? '')
    setFirmGstin(firm?.gstin ?? '')
  }, [firm?.name, firm?.gstin])

  const firmDirty = firmName.trim() !== (firm?.name ?? '') || (firmGstin.trim() || null) !== (firm?.gstin ?? null)

  const startEditingFirm = () => {
    setFirmError(null)
    setFirmSuccess(null)
    setEditingFirm(true)
  }

  const cancelEditingFirm = () => {
    setFirmName(firm?.name ?? '')
    setFirmGstin(firm?.gstin ?? '')
    setFirmError(null)
    setEditingFirm(false)
  }

  const isOwner = myRole === 'Owner'

  const load = async () => {
    if (!firmId) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('firm_members')
      .select('id, full_name, role, permissions, status, invited_email')
      .eq('firm_id', firmId)
      .order('full_name')
    if (err) { setError(err.message); setLoading(false); return }
    setMembers(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [firmId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (member, moduleKey) => {
    if (!isOwner || member.role === 'Owner') return
    const updated = { ...member.permissions, [moduleKey]: !member.permissions?.[moduleKey] }
    setSavingId(member.id)
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, permissions: updated } : m)))
    const { error: err } = await supabase.from('firm_members').update({ permissions: updated }).eq('id', member.id)
    setSavingId(null)
    if (err) {
      alert(`Couldn't save that change: ${err.message}`)
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, permissions: member.permissions } : m)))
    }
  }

  const handleInvite = async (e) => {
    e.preventDefault()
    setInviteError(null)
    setInviteSuccess(null)
    if (!inviteName.trim() || !inviteEmail.trim()) {
      setInviteError('Enter both a name and email.')
      return
    }
    setInviting(true)
    const permissions = inviteRole === 'Owner' ? OWNER_PERMISSIONS : DEFAULT_PERMISSIONS
    const { error: err } = await supabase.from('firm_members').insert({
      firm_id: firmId,
      invited_email: inviteEmail.trim(),
      full_name: inviteName.trim(),
      role: inviteRole,
      permissions,
      status: 'invited',
    })
    if (err) {
      setInviting(false)
      setInviteError(err.message)
      return
    }

    // The invite row above is what actually grants access the moment they
    // sign in - this email is just a courtesy notification, so a failure
    // here shouldn't look like the invite itself failed.
    const { error: emailErr } = await supabase.functions.invoke('send-invite-email', {
      body: { email: inviteEmail.trim(), fullName: inviteName.trim(), firmName: firm?.name || 'your firm' },
    })
    setInviting(false)

    setInviteSuccess(
      emailErr
        ? `Invited, but the email notification couldn't be sent (${emailErr.message}). Tell them to sign in at this app with ${inviteEmail.trim()} to get access.`
        : `Invited and emailed at ${inviteEmail.trim()} — they just need to sign in at this app with that address to get access.`
    )
    setInviteName('')
    setInviteEmail('')
    setInviteRole('Accountant')
    load()
  }

  const handleSaveFirm = async (e) => {
    e.preventDefault()
    setFirmError(null)
    setFirmSuccess(null)
    if (!firmName.trim()) {
      setFirmError('Firm name cannot be empty.')
      return
    }
    if (!firmDirty) {
      setEditingFirm(false)
      return
    }
    setSavingFirm(true)
    const { error: err } = await supabase
      .from('firms')
      .update({ name: firmName.trim(), gstin: firmGstin.trim() || null })
      .eq('id', firmId)
    setSavingFirm(false)
    if (err) {
      setFirmError(err.message)
      return
    }
    setFirmSuccess('Saved.')
    setEditingFirm(false)
    await refreshMemberships?.()
  }

  const handleRemove = async (member) => {
    if (!window.confirm(`Remove ${member.full_name} from this firm? They'll lose access immediately.`)) return
    setRemovingId(member.id)
    const { error: err } = await supabase.from('firm_members').delete().eq('id', member.id)
    setRemovingId(null)
    if (err) {
      alert(`Couldn't remove them: ${err.message}`)
      return
    }
    setMembers((prev) => prev.filter((m) => m.id !== member.id))
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title="Users & Permissions" note="who can see which module" />

      {isOwner && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 8 }}>
            <h2>Firm details</h2>
            {!editingFirm && (
              <button type="button" className="link-btn" onClick={startEditingFirm}>Edit</button>
            )}
          </div>

          {editingFirm ? (
            <form onSubmit={handleSaveFirm} className="add-comm-form">
              <div className="add-comm-row">
                <input className="text-input" placeholder="Firm name" value={firmName} onChange={(e) => setFirmName(e.target.value)} />
                <input className="text-input" placeholder="GSTIN (optional)" value={firmGstin} onChange={(e) => setFirmGstin(e.target.value)} />
              </div>
              {firmError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{firmError}</p>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-primary" disabled={savingFirm || !firmDirty}>{savingFirm ? 'Saving…' : 'Save firm details'}</button>
                <button type="button" className="link-btn" onClick={cancelEditingFirm}>Cancel</button>
              </div>
            </form>
          ) : (
            <div>
              <div style={{ color: 'var(--paper)' }}>{firm?.name}</div>
              {firm?.gstin && <div className="login-footnote" style={{ margin: 0 }}>{firm.gstin}</div>}
              {firmSuccess && <p className="text-[12.5px]" style={{ color: 'var(--teal)' }}>{firmSuccess}</p>}
            </div>
          )}
        </div>
      )}

      {isOwner && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 8 }}><h2>Invite a teammate</h2></div>
          <form onSubmit={handleInvite} className="add-comm-form">
            <div className="add-comm-row">
              <input className="text-input" placeholder="Full name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
              <input className="text-input" type="email" placeholder="Email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <select className="select select--sm" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {inviteError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{inviteError}</p>}
            {inviteSuccess && <p className="text-[12.5px]" style={{ color: 'var(--teal)' }}>{inviteSuccess}</p>}
            <button className="btn-primary" disabled={inviting}>{inviting ? 'Inviting…' : 'Send invite'}</button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="table-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Status</th>
              {MODULES.map((m) => <th key={m.key} className="num">{m.label}</th>)}
              {isOwner && <th className="num">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const pending = member.status === 'invited'
              return (
                <tr key={member.id} className="ledger-row">
                  <td>{member.full_name}{pending && <div className="login-footnote" style={{ margin: 0 }}>{member.invited_email}</div>}</td>
                  <td><span className="pill pill--neutral">{member.role}</span></td>
                  <td>{pending ? <span className="pill pill--warn">Pending</span> : <span className="pill pill--ok">Active</span>}</td>
                  {MODULES.map((m) => {
                    const locked = pending || member.role === 'Owner' || !isOwner
                    const on = member.role === 'Owner' ? true : !!member.permissions?.[m.key]
                    return (
                      <td key={m.key} className="num">
                        <button
                          className={`toggle ${on ? 'toggle--on' : ''} ${locked ? 'toggle--locked' : ''}`}
                          disabled={locked || savingId === member.id}
                          onClick={() => toggle(member, m.key)}
                          aria-label={`${member.full_name} ${m.label} ${on ? 'enabled' : 'disabled'}`}
                        >
                          <span className="toggle__dot" />
                        </button>
                      </td>
                    )
                  })}
                  {isOwner && (
                    <td className="num">
                      {member.role === 'Owner' || member.id === membershipId ? (
                        <span className="login-footnote" style={{ margin: 0 }}>—</span>
                      ) : (
                        <button
                          className="link-btn"
                          style={{ color: 'var(--brick)' }}
                          disabled={removingId === member.id}
                          onClick={() => handleRemove(member)}
                        >
                          {removingId === member.id ? 'Removing…' : 'Remove'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
            {members.length === 0 && (
              <tr><td colSpan={3 + MODULES.length + (isOwner ? 1 : 0)} className="empty-state">No team members yet.</td></tr>
            )}
          </tbody>
        </table>
        </div>
        {!isOwner && (
          <p className="login-footnote" style={{ marginTop: 14 }}>
            Only an Owner can invite people or change permissions.
          </p>
        )}
      </div>
    </>
  )
}
