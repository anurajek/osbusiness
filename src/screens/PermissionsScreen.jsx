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
]

const ROLES = ['Accountant', 'Viewer']
const OWNER_PERMISSIONS = { dashboard: true, sales: true, purchases: true, arap: true, cashbank: true, permissions: true }
const DEFAULT_PERMISSIONS = { dashboard: true, sales: true, purchases: true, arap: true, cashbank: true, permissions: false }

export default function PermissionsScreen() {
  const { firmId, role: myRole } = useFirm()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)

  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('Accountant')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [inviteSuccess, setInviteSuccess] = useState(null)

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
    setInviting(false)
    if (err) {
      setInviteError(err.message)
      return
    }
    setInviteSuccess(`Invited. Tell them to sign in at this app with ${inviteEmail.trim()} to get access.`)
    setInviteName('')
    setInviteEmail('')
    setInviteRole('Accountant')
    load()
  }

  if (loading) return <div className="empty-state">Loading…</div>
  if (error) return <div className="empty-state">Couldn't load this data: {error}</div>

  return (
    <>
      <SectionHeader title="Users & Permissions" note="who can see which module" />

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
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Status</th>
              {MODULES.map((m) => <th key={m.key} className="num">{m.label}</th>)}
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
                </tr>
              )
            })}
            {members.length === 0 && (
              <tr><td colSpan={3 + MODULES.length} className="empty-state">No team members yet.</td></tr>
            )}
          </tbody>
        </table>
        {!isOwner && (
          <p className="login-footnote" style={{ marginTop: 14 }}>
            Only an Owner can invite people or change permissions.
          </p>
        )}
      </div>
    </>
  )
}
