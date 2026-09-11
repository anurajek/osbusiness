import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useFirm } from '../context/FirmContext'

// Lives in the header (see AppShell.jsx), not the Dashboard - this is what
// "Recent activity" moved into, alongside the new personal assignment
// notifications. Notification rows themselves are only ever written by
// the notify_on_assignment() trigger (migration_notifications.sql) - this
// component only ever reads and marks-read, never inserts.
export default function NotificationBell({ onNavigate }) {
  const { firmId, membershipId } = useFirm()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [activity, setActivity] = useState([])

  const load = async () => {
    if (!firmId) return
    const [{ data: notifs }, { data: act }] = await Promise.all([
      membershipId
        ? supabase.from('notifications').select('id, message, party_kind, party_id, read, created_at').eq('member_id', membershipId).order('created_at', { ascending: false }).limit(20)
        : Promise.resolve({ data: [] }),
      supabase.from('activity_log').select('id, description, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(10),
    ])
    setNotifications(notifs ?? [])
    setActivity(act ?? [])
  }

  useEffect(() => { load() }, [firmId, membershipId]) // eslint-disable-line react-hooks/exhaustive-deps

  const unreadCount = notifications.filter((n) => !n.read).length

  const markRead = async (n) => {
    if (n.read) return
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    await supabase.from('notifications').update({ read: true }).eq('id', n.id)
  }

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id)
    if (unreadIds.length === 0) return
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
  }

  const handleClick = (n) => {
    markRead(n)
    setOpen(false)
    if (n.party_id && n.party_kind) {
      onNavigate('arap', n.party_kind === 'ar' ? 'receivables' : 'payables', n.party_kind === 'ar' ? { customerId: n.party_id } : { supplierId: n.party_id })
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="theme-toggle" style={{ position: 'relative' }}
        onClick={() => setOpen((v) => !v)}
        title="Notifications" aria-label="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="mention-menu" style={{ left: 'auto', right: 0, minWidth: 320, maxWidth: 360, maxHeight: 'none', overflow: 'visible', padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--rule)' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>
            {unreadCount > 0 && <button type="button" className="link-btn" style={{ padding: 0, fontSize: 11.5 }} onClick={markAllRead}>Mark all read</button>}
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {notifications.length === 0 && <p className="empty-state" style={{ padding: '14px 12px' }}>Nothing yet.</p>}
            {notifications.map((n) => (
              <button
                type="button" key={n.id} onClick={() => handleClick(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
                  background: n.read ? 'none' : 'color-mix(in srgb, var(--brass) 12%, transparent)',
                  borderBottom: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--paper)', fontSize: 12.5,
                }}
              >
                {n.message}
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--paper-dim)', marginTop: 2 }}>{new Date(n.created_at).toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--rule)', maxHeight: 200, overflowY: 'auto' }}>
            <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 6, color: 'var(--paper-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent activity</div>
            {activity.length === 0 && <p className="empty-state" style={{ padding: 0 }}>Nothing logged yet.</p>}
            {activity.map((a) => (
              <div key={a.id} style={{ fontSize: 12, padding: '4px 0' }}>
                {a.description}
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--paper-dim)' }}>{new Date(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
