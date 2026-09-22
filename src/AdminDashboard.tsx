import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Activity, ArrowLeft, Ban, Check, DollarSign, ExternalLink, Mail, RefreshCw, Search, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { Input } from './components/ui/input'

type AccessStatus = 'pending' | 'approved' | 'blocked'

export function AdminDashboard({ onClose }: { onClose: () => void }) {
  const users = useQuery(api.admin.listUsers)
  const [reportNow, setReportNow] = useState(() => Date.now())
  const usage = useQuery(api.admin.usageOverview, { now: reportNow })
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
      <Button variant="outline" type="button" onClick={onClose}><ArrowLeft /> Back to Saathi</Button>
      <div><span><ShieldCheck /> Superadmin</span><h1>Operations</h1><p>Monitor deployment-funded AI usage by family, then manage account access.</p></div>
    </header>
    <section className="usage-admin" aria-labelledby="usage-heading">
      <div className="usage-admin-heading">
        <div><span><Activity /> Usage & cost</span><h2 id="usage-heading">Tracked AI cost</h2><p>Estimated provider cost from metered Saathi activity. GPT-Live session time and delegated Luna work are itemized separately.</p></div>
        <Button variant="outline" type="button" onClick={() => setReportNow(Date.now())}><RefreshCw /> Refresh</Button>
      </div>
      {usage === undefined
        ? <p className="usage-loading">Loading usage…</p>
        : <>
          <div className="usage-summary-cards">
            <Card><DollarSign /><span>Platform-funded this month</span><strong>{formatUsd(usage.totals.monthPlatformCostUsd)}</strong><small>Deployment keys + legacy rows</small></Card>
            <Card><Activity /><span>Projected platform cost</span><strong>{formatUsd(usage.totals.projectedPlatformMonthlyUsd)}</strong><small>Current UTC-month run rate</small></Card>
            <Card><DollarSign /><span>Family BYOK spend</span><strong>{formatUsd(usage.totals.familyByokCostUsd)}</strong><small>Tracked, paid by families</small></Card>
            <Card><Activity /><span>{usage.rowLimitReached ? 'Latest tracked spend' : 'All tracked spend'}</span><strong>{formatUsd(usage.totals.trackedCostUsd)}</strong><small>{usage.trackedRows.toLocaleString()} ledger rows</small></Card>
          </div>
          <div className="usage-admin-grid">
            <section className="usage-panel">
              <div className="usage-panel-title"><div><h3>Cost by service</h3><p>The GPT-Live session row excludes separately billed Luna and tool work.</p></div></div>
              <div className="usage-table-wrap"><table><thead><tr><th>Service</th><th>This month</th><th>Tracked total</th><th>Units</th></tr></thead><tbody>
                {usage.services.length === 0 && <tr><td colSpan={4}>No metered usage recorded yet.</td></tr>}
                {usage.services.map(service => <tr key={service.key}><td><strong>{service.label}</strong>{service.unknownCostRows > 0 && <small>{service.unknownCostRows} unpriced row{service.unknownCostRows === 1 ? '' : 's'}</small>}</td><td>{formatUsd(service.monthCostUsd)}</td><td>{formatUsd(service.trackedCostUsd)}</td><td>{formatQuantity(service.quantity)} {service.unit}{service.quantity === 1 ? '' : 's'}</td></tr>)}
              </tbody></table></div>
            </section>
            <aside className="usage-panel convex-usage-note">
              <div><Activity /><h3>Convex infrastructure</h3></div>
              <p>Database, function, storage, and bandwidth credits are measured by Convex, outside Saathi’s provider ledger. Open the deployment dashboard for the authoritative balance and billing forecast.</p>
              <a href={usage.convexDashboardUrl} target="_blank" rel="noreferrer">Open Convex usage <ExternalLink /></a>
            </aside>
          </div>
          <section className="usage-panel family-cost-panel">
            <div className="usage-panel-title"><div><h3>Cost by family</h3><p>Projected cost uses this month’s average daily platform-funded spend.</p></div></div>
            <div className="usage-table-wrap"><table><thead><tr><th>Family</th><th>Tier</th><th>This month</th><th>Platform projection</th><th>Tracked total</th></tr></thead><tbody>
              {usage.families.map(family => <tr key={family.spaceId}><td><strong>{family.name}</strong><small>{family.usageRows} usage row{family.usageRows === 1 ? '' : 's'}{family.unknownCostRows ? ` · ${family.unknownCostRows} unpriced` : ''}</small></td><td>{family.modelTier}</td><td>{formatUsd(family.monthCostUsd)}</td><td>{formatUsd(family.projectedPlatformMonthlyUsd)}</td><td>{formatUsd(family.trackedCostUsd)}</td></tr>)}
            </tbody></table></div>
          </section>
          {(usage.totals.unknownCostRows > 0 || usage.rowLimitReached || usage.familyLimitReached) && <p className="usage-caveat">{usage.totals.unknownCostRows > 0 ? `Estimate excludes ${usage.totals.unknownCostRows} visible row${usage.totals.unknownCostRows === 1 ? '' : 's'} without a usable USD cost. ` : ''}{usage.rowLimitReached ? 'Totals use only the latest 5,000 ledger rows. ' : ''}{usage.familyLimitReached ? 'The family table is limited to 200 families represented in those rows.' : ''}</p>}
        </>}
    </section>
    <section className="access-admin-toolbar">
      <div className="access-section-heading"><h2>Account access</h2><p>Approve people who can use deployment-funded AI keys.</p></div>
      <div className="access-stats">
        <Button variant="outline" className={filter === 'pending' ? 'selected' : ''} onClick={() => setFilter('pending')}><strong>{counts.pending}</strong><span>Pending</span></Button>
        <Button variant="outline" className={filter === 'approved' ? 'selected' : ''} onClick={() => setFilter('approved')}><strong>{counts.approved}</strong><span>Approved</span></Button>
        <Button variant="outline" className={filter === 'blocked' ? 'selected' : ''} onClick={() => setFilter('blocked')}><strong>{counts.blocked}</strong><span>Blocked</span></Button>
        <Button variant="outline" className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}><strong>{users?.length ?? 0}</strong><span>All</span></Button>
      </div>
      <label className="access-search"><Search /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or email" /></label>
      {message && <p role="status">{message}</p>}
    </section>
    <section className="access-user-list" aria-label="User access requests">
      {users === undefined && <p>Loading accounts…</p>}
      {users !== undefined && visibleUsers.length === 0 && <p>No accounts match this view.</p>}
      {visibleUsers.map(user => <article key={user._id} className={`access-user-row status-${user.status}`}>
        <div className="access-user-identity"><span>{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><a href={`mailto:${encodeURIComponent(user.email)}`}>{user.email}</a><small>Joined {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(user.createdAt)}{user.requestedAt ? ` · requested ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(user.requestedAt)}` : ''}</small></div></div>
        <span className="access-status">{user.isSuperadmin ? 'superadmin' : user.status}</span>
        <div className="access-user-actions">
          <a href={`mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent('Your Saathi access')}`}><Mail /> Email</a>
          {!user.isSuperadmin && user.status !== 'approved' && <Button disabled={busyUserId === user._id} onClick={() => void update(user._id, 'approved')}><UserRoundCheck /> Approve</Button>}
          {!user.isSuperadmin && user.status !== 'blocked' && (confirmingBlockId === user._id
            ? <><Button variant="destructive" className="danger" disabled={busyUserId === user._id} onClick={() => void update(user._id, 'blocked')}><Ban /> Confirm block</Button><Button variant="outline" disabled={busyUserId === user._id} onClick={() => setConfirmingBlockId(null)}>Cancel</Button></>
            : <Button variant="destructive" className="danger" disabled={busyUserId === user._id} onClick={() => setConfirmingBlockId(user._id)}><Ban /> Block</Button>)}
          {!user.isSuperadmin && user.status !== 'pending' && <Button variant="outline" disabled={busyUserId === user._id} onClick={() => void update(user._id, 'pending')}><Check /> Reset</Button>}
        </div>
      </article>)}
    </section>
  </main>
}

function formatUsd(value: number) {
  const digits = value > 0 && value < 0.01 ? 4 : 2
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}
