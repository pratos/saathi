import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ArrowLeft, Ban, Check, Mail, Search, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'

type AccessStatus = 'pending' | 'approved' | 'blocked'

export function AdminDashboard({ onClose }: { onClose: () => void }) {
  const users = useQuery(api.admin.listUsers)
  const setAccessStatus = useMutation(api.admin.setAccessStatus)
  const [filter, setFilter] = useState<AccessStatus | 'all'>('pending')
  const [search, setSearch] = useState('')
  const [busyUserId, setBusyUserId] = useState<Id<'users'> | null>(null)
  const [confirmingBlockId, setConfirmingBlockId] = useState<Id<'users'> | null>(null)
  const [message, setMessage] = useState('')

  const visibleUsers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (users ?? []).filter(user =>
      (filter === 'all' || user.status === filter)
      && (!needle || `${user.name} ${user.email}`.toLowerCase().includes(needle)),
    )
  }, [filter, search, users])

  const update = async (userId: Id<'users'>, status: AccessStatus) => {
    setBusyUserId(userId)
    setMessage('')
    try {
      await setAccessStatus({ userId, status })
      setConfirmingBlockId(null)
      setMessage(`Access marked ${status}.`)
    } catch {
      setMessage('Access could not be updated.')
    } finally {
      setBusyUserId(null)
    }
  }

  const counts = (users ?? []).reduce<Record<AccessStatus, number>>((total, user) => {
    total[user.status] += 1
    return total
  }, { pending: 0, approved: 0, blocked: 0 })

  return <main className="access-admin-page">
    <header className="access-admin-header">
      <button type="button" onClick={onClose}><ArrowLeft /> Back to Saath</button>
      <div><span><ShieldCheck /> Superadmin</span><h1>Account access</h1><p>Approve people who can use deployment-funded AI keys. Families with their own OpenRouter key can start without approval.</p></div>
    </header>
    <section className="access-admin-toolbar">
      <div className="access-stats">
        <button className={filter === 'pending' ? 'selected' : ''} onClick={() => setFilter('pending')}><strong>{counts.pending}</strong><span>Pending</span></button>
        <button className={filter === 'approved' ? 'selected' : ''} onClick={() => setFilter('approved')}><strong>{counts.approved}</strong><span>Approved</span></button>
        <button className={filter === 'blocked' ? 'selected' : ''} onClick={() => setFilter('blocked')}><strong>{counts.blocked}</strong><span>Blocked</span></button>
        <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}><strong>{users?.length ?? 0}</strong><span>All</span></button>
      </div>
      <label className="access-search"><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or email" /></label>
      {message && <p role="status">{message}</p>}
    </section>
    <section className="access-user-list" aria-label="User access requests">
      {users === undefined && <p>Loading accounts…</p>}
      {users !== undefined && visibleUsers.length === 0 && <p>No accounts match this view.</p>}
      {visibleUsers.map(user => <article key={user._id} className={`access-user-row status-${user.status}`}>
        <div className="access-user-identity"><span>{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><a href={`mailto:${encodeURIComponent(user.email)}`}>{user.email}</a><small>Joined {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(user.createdAt)}{user.requestedAt ? ` · requested ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(user.requestedAt)}` : ''}</small></div></div>
        <span className="access-status">{user.isSuperadmin ? 'superadmin' : user.status}</span>
        <div className="access-user-actions">
          <a href={`mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent('Your Saath access')}`}><Mail /> Email</a>
          {!user.isSuperadmin && user.status !== 'approved' && <button disabled={busyUserId === user._id} onClick={() => void update(user._id, 'approved')}><UserRoundCheck /> Approve</button>}
          {!user.isSuperadmin && user.status !== 'blocked' && (confirmingBlockId === user._id
            ? <><button className="danger" disabled={busyUserId === user._id} onClick={() => void update(user._id, 'blocked')}><Ban /> Confirm block</button><button disabled={busyUserId === user._id} onClick={() => setConfirmingBlockId(null)}>Cancel</button></>
            : <button className="danger" disabled={busyUserId === user._id} onClick={() => setConfirmingBlockId(user._id)}><Ban /> Block</button>)}
          {!user.isSuperadmin && user.status !== 'pending' && <button disabled={busyUserId === user._id} onClick={() => void update(user._id, 'pending')}><Check /> Reset</button>}
        </div>
      </article>)}
    </section>
  </main>
}
