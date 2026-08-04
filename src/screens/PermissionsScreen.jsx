import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'
import { SectionHeader } from '../components/ui'

// Refocused on AR/AP collections (Aug 2026) - Quotations, Credit/Debit
// Notes, and Ledger are hidden from this toggle grid (and from the nav in
// AppShell.jsx) but not deleted anywhere. The permission keys below still
// include them so nothing breaks if they're re-enabled later - only the
// visible module list is trimmed.
const MODULES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'sales', label: 'Sales' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'arap', label: 'AR / AP' },
  { key: 'cashbank', label: 'Cash & Bank' },
  { key: 'import', label: 'Import Data' },
]

const ROLES = ['Accountant', 'Viewer']
const OWNER_PERMISSIONS = { dashboard: true, sales: true, purchases: true, quotes: true, notes: true, arap: true, cashbank: true, ledger: true, import: true, permissions: true }
const DEFAULT_PERMISSIONS = { dashboard: true, sales: true, purchases: true, quotes: true, notes: true, arap: true, cashbank: true, ledger: false, import: false, permissions: false }

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

  const blankFirmForm = () => ({
    name: firm?.name ?? '',
    gstin: firm?.gstin ?? '',
    address: firm?.address ?? '',
    phone: firm?.phone ?? '',
    email: firm?.email ?? '',
    logo_url: firm?.logo_url ?? '',
    bank_details: firm?.bank_details ?? '',
    invoice_prefix: firm?.invoice_prefix ?? 'INV-',
  })
  const [firmForm, setFirmForm] = useState(blankFirmForm)
  const [savingFirm, setSavingFirm] = useState(false)
  const [firmError, setFirmError] = useState(null)
  const [firmSuccess, setFirmSuccess] = useState(null)
  const [editingFirm, setEditingFirm] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState(null)
  const setFirmField = (key) => (e) => setFirmForm((f) => ({ ...f, [key]: e.target.value }))

  // Keep the form in sync if the selected firm changes (multi-firm users)
  // or after a save refreshes `firm` with the latest saved values.
  useEffect(() => {
    setFirmForm(blankFirmForm())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firm])

  const firmDirty = Object.keys(blankFirmForm()).some((k) => firmForm[k] !== blankFirmForm()[k])

  const startEditingFirm = () => {
    setFirmError(null)
    setFirmSuccess(null)
    setEditingFirm(true)
  }

  const cancelEditingFirm = () => {
    setFirmForm(blankFirmForm())
    setFirmError(null)
    setLogoError(null)
    setEditingFirm(false)
  }

  const ALLOWED_LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' }

  const handleLogoFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let choosing the same file again re-trigger onChange
    if (!file) return
    setLogoError(null)

    const ext = ALLOWED_LOGO_TYPES[file.type]
    if (!ext) {
      setLogoError('Please choose a PNG or JPEG/JPG image.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('That image is over 2MB - please choose a smaller one.')
      return
    }

    setUploadingLogo(true)
    const path = `${firmId}/logo.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('firm-logos')
      .upload(path, file, { upsert: true, contentType: file.type })
    setUploadingLogo(false)
    if (uploadErr) {
      setLogoError(uploadErr.message)
      return
    }

    const { data } = supabase.storage.from('firm-logos').getPublicUrl(path)
    // Cache-bust so a replaced logo shows the new image immediately,
    // instead of the browser (or CDN) serving the old cached file at the
    // same path.
    setFirmForm((f) => ({ ...f, logo_url: `${data.publicUrl}?v=${Date.now()}` }))
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
    const { data: { session: currentSession } } = await supabase.auth.getSession()
    const { data: inviteRow, error: err } = await supabase.from('firm_members').insert({
      firm_id: firmId,
      invited_email: inviteEmail.trim(),
      full_name: inviteName.trim(),
      role: inviteRole,
      permissions,
      status: 'invited',
      invited_by: currentSession?.user?.id ?? null,
    }).select('invite_token').single()
    if (err) {
      setInviting(false)
      setInviteError(err.message)
      return
    }

    // The invite row above is what actually grants access the moment they
    // accept it - this email is just a courtesy notification, so a failure
    // here shouldn't look like the invite itself failed. The token is what
    // makes the link in this email lead straight to a dedicated "Join
    // {firm}" page locked to this one invite, instead of the app's plain
    // homepage - see AcceptInviteScreen.jsx.
    const { error: emailErr } = await supabase.functions.invoke('send-invite-email', {
      body: { email: inviteEmail.trim(), fullName: inviteName.trim(), firmName: firm?.name || 'your firm', token: inviteRow.invite_token },
    })
    setInviting(false)

    // supabase-js hardcodes this exact message when it can't reach the
    // function at all (as opposed to the function running but failing
    // internally, e.g. a missing Resend API key) - almost always means
    // send-invite-email hasn't actually been deployed on this Supabase
    // project yet, so it's worth saying that plainly rather than just
    // surfacing the raw, fairly cryptic error text.
    const notDeployed = emailErr && /Failed to send a request/i.test(emailErr.message || '')

    setInviteSuccess(
      emailErr
        ? notDeployed
          ? `Invited — but the invite-email feature hasn't been deployed yet, so no email went out. Tell them to sign in at this app with ${inviteEmail.trim()} to get access. (See the README's "Invite emails" section for the one-time setup.)`
          : `Invited, but the email notification couldn't be sent (${emailErr.message}). Tell them to sign in at this app with ${inviteEmail.trim()} to get access.`
        : `Invited and emailed at ${inviteEmail.trim()} — they'll get a link that takes them straight to a "Join ${firm?.name || 'your firm'}" page.`
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
    if (!firmForm.name.trim()) {
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
      .update({
        name: firmForm.name.trim(),
        gstin: firmForm.gstin.trim() || null,
        address: firmForm.address.trim() || null,
        phone: firmForm.phone.trim() || null,
        email: firmForm.email.trim() || null,
        logo_url: firmForm.logo_url.trim() || null,
        bank_details: firmForm.bank_details.trim() || null,
        invoice_prefix: firmForm.invoice_prefix.trim() || 'INV-',
      })
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
                <input className="text-input" placeholder="Firm name" value={firmForm.name} onChange={setFirmField('name')} />
                <input className="text-input" placeholder="GSTIN (optional)" value={firmForm.gstin} onChange={setFirmField('gstin')} />
              </div>
              <div className="add-comm-row">
                <input className="text-input" placeholder="Address" value={firmForm.address} onChange={setFirmField('address')} />
              </div>
              <div className="add-comm-row">
                <input className="text-input" placeholder="Phone" value={firmForm.phone} onChange={setFirmField('phone')} />
                <input className="text-input" type="email" placeholder="Business email" value={firmForm.email} onChange={setFirmField('email')} />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>Logo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {firmForm.logo_url && (
                    <>
                      <img src={firmForm.logo_url} alt="Firm logo" style={{ height: 40, width: 40, objectFit: 'contain', borderRadius: 6, background: 'var(--panel-alt)' }} />
                      <button type="button" className="link-btn" onClick={() => setFirmForm((f) => ({ ...f, logo_url: '' }))}>Remove</button>
                    </>
                  )}
                  <label className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', cursor: uploadingLogo ? 'default' : 'pointer', opacity: uploadingLogo ? 0.6 : 1 }}>
                    {uploadingLogo ? 'Uploading…' : firmForm.logo_url ? 'Replace logo' : 'Upload logo'}
                    <input type="file" accept="image/png,image/jpeg,image/jpg" onChange={handleLogoFileChange} disabled={uploadingLogo} style={{ display: 'none' }} />
                  </label>
                </div>
                <p className="login-footnote" style={{ marginTop: 4 }}>PNG or JPEG/JPG, up to 2MB.</p>
                {logoError && <p className="text-[12.5px]" style={{ color: 'var(--brick)' }}>{logoError}</p>}
              </div>
              <div className="add-comm-row">
                <input className="text-input" style={{ maxWidth: 160 }} placeholder="Invoice prefix" value={firmForm.invoice_prefix} onChange={setFirmField('invoice_prefix')} />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--paper-dim)' }}>Payment instructions (shown on invoice PDFs)</label>
                <textarea className="textarea" rows={3} placeholder="Bank name, account number, IFSC, UPI ID, etc." value={firmForm.bank_details} onChange={setFirmField('bank_details')} />
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
              {firm?.gstin && <div className="login-footnote" style={{ margin: 0 }}>GSTIN: {firm.gstin}</div>}
              {firm?.address && <div className="login-footnote" style={{ margin: 0 }}>{firm.address}</div>}
              {(firm?.phone || firm?.email) && (
                <div className="login-footnote" style={{ margin: 0 }}>{[firm?.phone, firm?.email].filter(Boolean).join(' · ')}</div>
              )}
              {!firm?.address && !firm?.phone && !firm?.email && !firm?.bank_details && (
                <p className="login-footnote" style={{ marginTop: 6 }}>
                  Add an address, contact info, and payment instructions here so invoice PDFs look complete.
                </p>
              )}
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
