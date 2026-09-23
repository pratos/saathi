import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Activity, ArrowLeft, Ban, Check, CircleAlert, DollarSign, ExternalLink, KeyRound, Mail, RefreshCw, Route, Search, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { Input } from './components/ui/input'

type AccessStatus = 'pending' | 'approved' | 'blocked'

export function AdminDashboard({ onClose }: { onClose: () => void }) {
  const users = useQuery(api.admin.listUsers)
  const recategorizations = useQuery(api.admin.recentRecategorizations)
  const [reportNow, setReportNow] = useState(() => Date.now())
  const usage = useQuery(api.admin.usageOverview, { now: reportNow })
  const emailOperations = useQuery(api.admin.emailOperations, { now: reportNow })
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
      setMessage('Could not update access. Try again.')
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
      <div><span><ShieldCheck /> Superadmin</span><h1>Operations</h1><p>Review email delivery and extraction, monitor deployment-funded AI usage, and manage account access.</p></div>
    </header>
    <section className="usage-admin email-operations" aria-labelledby="email-operations-heading">
      <div className="usage-admin-heading">
        <div><span><Mail /> Email operations</span><h2 id="email-operations-heading">From inbox to family</h2><p>Operational metadata only. Message bodies, OTP values, provider credentials, and authentication tokens never appear here.</p></div>
        <Button variant="outline" type="button" onClick={() => setReportNow(Date.now())}><RefreshCw /> Refresh</Button>
      </div>
      {emailOperations === undefined
        ? <p className="usage-loading">Loading email operations…</p>
        : <>
          <div className="email-flow" aria-label="Email processing flow">
            <span><Mail /><strong>Receive</strong><small>Gmail or AgentMail</small></span>
            <i aria-hidden="true" />
            <span><Route /><strong>Parse</strong><small>Classify and extract</small></span>
            <i aria-hidden="true" />
            <span><Check /><strong>Deliver</strong><small>Private or family inbox</small></span>
          </div>
          <div className="usage-summary-cards email-summary-cards">
            <Card><Check /><span>Ready</span><strong>{emailOperations.inbox.ready}</strong><small>of {emailOperations.inbox.sampled} recent messages</small></Card>
            <Card><Activity /><span>Processing</span><strong>{emailOperations.inbox.received + emailOperations.inbox.processing}</strong><small>{emailOperations.inbox.received} queued · {emailOperations.inbox.processing} active</small></Card>
            <Card><CircleAlert /><span>Failed</span><strong>{emailOperations.inbox.failed}</strong><small>open the source flow before retrying</small></Card>
            <Card><KeyRound /><span>Expiring OTPs</span><strong>{emailOperations.inbox.otp}</strong><small>codes are never returned to this panel</small></Card>
          </div>
          <div className="usage-admin-grid email-health-grid">
            <section className="usage-panel email-health-panel">
              <div className="usage-panel-title"><div><h3>Integration health</h3><p>Configuration is reported as present or missing; secret values stay server-side.</p></div></div>
              <ul className="email-health-list">
                <HealthRow label="AgentMail inbound" ready={emailOperations.configuration.agentmail} detail={`${emailOperations.families.withAgentmail} family inboxes`} />
                <HealthRow label="Authentication email" ready={emailOperations.configuration.authDelivery} detail="one-time sign-in codes" />
                <HealthRow label="Gmail import" ready={emailOperations.configuration.gmail && emailOperations.configuration.gmailWebhook} detail={`${emailOperations.gmail.active} active · ${emailOperations.gmail.error} errors`} />
                <HealthRow label="OTP family sharing" ready={emailOperations.families.otpSharingEnabled > 0} detail={`${emailOperations.families.otpSharingEnabled} families enabled`} neutral />
              </ul>
            </section>
            <section className="usage-panel email-category-panel">
              <div className="usage-panel-title"><div><h3>Recent routing</h3><p>How the latest bounded sample was delivered and extracted.</p></div></div>
              <dl>
                <div><dt>Private Gmail</dt><dd>{emailOperations.inbox.private}</dd></div>
                <div><dt>Family inbox</dt><dd>{emailOperations.inbox.shared}</dd></div>
                <div><dt>Forwarded by family</dt><dd>{emailOperations.inbox.forwarded}</dd></div>
                <div><dt>Amounts extracted</dt><dd>{emailOperations.inbox.withAmount}</dd></div>
              </dl>
              <div className="email-category-chips">{emailOperations.categories.slice(0, 6).map(item => <span key={item.category}>{formatEmailLabel(item.category)} <strong>{item.count}</strong></span>)}</div>
            </section>
          </div>
          <section className="usage-panel email-events-panel">
            <div className="usage-panel-title"><div><h3>Recent pipeline events</h3><p>Sender addresses are masked. Subjects and message content are intentionally excluded.</p></div></div>
            <div className="usage-table-wrap"><table><thead><tr><th>Family and source</th><th>Status</th><th>Classification</th><th>Extraction</th><th>Received</th></tr></thead><tbody>
              {emailOperations.recent.length === 0 && <tr><td colSpan={5}>No email has entered the pipeline yet.</td></tr>}
              {emailOperations.recent.map(item => <tr key={item.itemId}><td><strong>{item.familyName}</strong><small>{formatEmailLabel(item.source)} · {item.sender}</small></td><td><span className={`access-status recategorization-${item.status === 'ready' ? 'complete' : item.status}`}>{item.status}</span></td><td><strong>{formatEmailLabel(item.category)}</strong><small>{item.subcategory ? formatEmailLabel(item.subcategory) : 'No subtype'}</small></td><td>{item.isOtp ? 'OTP · expires automatically' : [item.hasAmount && 'amount', item.hasDueDate && 'due date', item.parseStatus && `document ${item.parseStatus}`].filter(Boolean).join(' · ') || 'No structured values'}</td><td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(item.receivedAt)}</td></tr>)}
            </tbody></table></div>
          </section>
          {(emailOperations.limits.inbox || emailOperations.limits.gmail || emailOperations.limits.families) && <p className="usage-caveat">This operational view is bounded to the latest 500 inbox items, 200 Gmail connections, and 200 families.</p>}
        </>}
    </section>
    <section className="usage-admin" aria-labelledby="usage-heading">
      <div className="usage-admin-heading">
        <div><span><Activity /> Usage & cost</span><h2 id="usage-heading">Tracked AI cost</h2><p>Estimated provider costs for recorded Saathi activity. GPT-Live session time and delegated Luna work are listed separately.</p></div>
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
    <section className="usage-panel recategorization-admin" aria-labelledby="recategorization-heading">
      <div className="usage-panel-title"><div><h2 id="recategorization-heading">Email recategorization</h2><p>Latest durable background runs across family inboxes.</p></div></div>
      <div className="usage-table-wrap"><table><thead><tr><th>Family</th><th>Status</th><th>Updated</th><th>Result</th></tr></thead><tbody>
        {recategorizations === undefined && <tr><td colSpan={4}>Loading recategorization jobs…</td></tr>}
        {recategorizations?.length === 0 && <tr><td colSpan={4}>No recategorization has been started yet.</td></tr>}
        {recategorizations?.map(job => <tr key={job.jobId}><td><strong>{job.familyName}</strong><small>Started {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(job.startedAt)}</small></td><td><span className={`access-status recategorization-${job.status}`}>{job.status}</span></td><td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(job.updatedAt)}</td><td>{job.recategorized} updated · {job.skipped} skipped · {job.discovered} found{job.error ? <small>{job.error}</small> : null}</td></tr>)}
      </tbody></table></div>
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
          {!user.isSuperadmin && user.status !== 'pending' && <Button variant="outline" disabled={busyUserId === user._id} onClick={() => void update(user._id, 'pending')}><Check /> Mark as pending</Button>}
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

function formatEmailLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase())
}

function HealthRow({ label, ready, detail, neutral = false }: { label: string; ready: boolean; detail: string; neutral?: boolean }) {
  return <li><span className={ready ? 'ready' : neutral ? 'neutral' : 'missing'}>{ready ? <Check /> : <CircleAlert />}</span><div><strong>{label}</strong><small>{detail}</small></div><b>{ready ? 'Ready' : neutral ? 'Not enabled' : 'Needs setup'}</b></li>
}
