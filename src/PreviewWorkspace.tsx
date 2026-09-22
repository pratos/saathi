import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Brain,
  Check,
  CircleStop,
  ExternalLink,
  Eye,
  FileText,
  Globe2,
  Inbox,
  Languages,
  LockKeyhole,
  Mail,
  MemoryStick,
  Mic,
  Monitor,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Label } from './components/ui/label'
import { Progress } from './components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import './PreviewWorkspace.css'

type StepId = 'inbox' | 'language' | 'memory' | 'research' | 'handoff' | 'approval' | 'privacy'
type Step = {
  id: StepId
  label: string
  task: string
  guide: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  route: string
  providers: string[]
}

const steps: Step[] = [
  { id: 'inbox', label: 'Review a family email', task: 'Find the amount and due date', guide: 'Review the source, then ask Saathi to find the amount and due date.', icon: Inbox, route: 'agentmail.inbound → inbox.extract', providers: ['AgentMail', 'OpenAI', 'Convex'] },
  { id: 'language', label: 'Translate the conversation', task: 'Let everyone read in their language', guide: 'Choose how Asha should read Appa’s original message.', icon: Languages, route: 'message.original → translation.cache', providers: ['OpenRouter', 'Convex'] },
  { id: 'memory', label: 'Save a family preference', task: 'Save one useful family preference', guide: 'Review what Saathi understood, then choose whether to remember it.', icon: Brain, route: 'jev.route → agent.memory', providers: ['TypeSafe Jev', 'Pi', 'Convex'] },
  { id: 'research', label: 'Review sample travel updates', task: 'Review sample search results', guide: 'Try a sample web search, then choose a source.', icon: Globe2, route: 'query.sanitize → firecrawl.search', providers: ['Firecrawl', 'Pi', 'OpenRouter'] },
  { id: 'handoff', label: 'Continue by voice or browser', task: 'Choose how to continue', guide: 'Choose how to continue. You always handle sign-in and payment.', icon: AudioLines, route: 'voice.intent → jev.browser → handoff', providers: ['OpenAI Live', 'Jev', 'Firecrawl'] },
  { id: 'approval', label: 'Review a draft reply', task: 'Review the recipient and reply', guide: 'Check the recipient and final message before confirming the sample reply.', icon: ShieldCheck, route: 'draft.create → permission.check → confirm', providers: ['AgentMail', 'Convex'] },
  { id: 'privacy', label: 'Switch family workspaces', task: 'Switch spaces without carrying data over', guide: 'Move to the Rao family and confirm that the Kapoor trip is no longer visible.', icon: LockKeyhole, route: 'space.switch → subscription.replace', providers: ['Convex Auth', 'Convex'] },
]

const boundaries: Record<StepId, string> = {
  inbox: 'Original email stays beside every extracted field.',
  language: 'Translation changes the reader view, never the canonical message.',
  memory: 'Only explicit facts are retained, scoped to this room and family.',
  research: 'Only the sanitized public question reaches web research.',
  handoff: 'Passwords, OTPs, payments, and confirmation stay with the person.',
  approval: 'Drafting and execution are separate, freshly authorized operations.',
  privacy: 'Family scope changes at the authorization boundary, not with a UI filter.',
}

export function PreviewWorkspace({ onExit, onOpenLive }: { onExit: () => void; onOpenLive: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [completed, setCompleted] = useState<StepId[]>([])
  const [runState, setRunState] = useState<'waiting' | 'running' | 'complete'>('waiting')
  const [restartGeneration, setRestartGeneration] = useState(0)
  const active = steps[activeIndex]
  const isComplete = completed.includes(active.id)
  const journeyComplete = completed.length === steps.length
  const showCompletion = journeyComplete && activeIndex === steps.length - 1 && isComplete

  const completeStep = () => {
    setCompleted((current) => current.includes(active.id) ? current : [...current, active.id])
    setRunState('complete')
  }

  const goTo = (index: number) => {
    if (index > completed.length || index < 0 || index >= steps.length) return
    setActiveIndex(index)
    setRunState(completed.includes(steps[index].id) ? 'complete' : 'waiting')
  }

  const restart = () => {
    setActiveIndex(0)
    setCompleted([])
    setRunState('waiting')
    setRestartGeneration((current) => current + 1)
  }

  return (
    <main className={`onboarding-shell ${showCompletion ? 'journey-complete' : ''}`}>
      <header className="onboarding-topbar">
        <Button variant="bare" size="content" className="topbar-exit" type="button" onClick={onExit} aria-label="Exit preview"><ArrowLeft /><span>Exit preview</span></Button>
        <div className="topbar-title"><span>Saathi preview</span><b>Kapoor family example</b></div>
        <Badge variant="accent" className="simulation-badge"><Eye /> SIMULATION · SAMPLE DATA</Badge>
        <div className="topbar-progress" aria-label={`${completed.length} of ${steps.length} steps complete`}>
          <span>{String(Math.min(activeIndex + 1, steps.length)).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span>
          <Progress value={(completed.length / steps.length) * 100} />
        </div>
      </header>

      <div className="onboarding-grid">
        <aside className="journey-rail" aria-label="Onboarding steps">
          <div className="rail-brand"><span>स</span><div><strong>Learn by doing</strong><small>One connected family task</small></div></div>
          <nav>
            {steps.map((step, index) => {
              const Icon = step.icon
              const done = completed.includes(step.id)
              const locked = index > completed.length
              return <Button
                type="button"
                variant="bare"
                size="content"
                key={step.id}
                className={`${index === activeIndex ? 'active' : ''} ${done ? 'done' : ''}`}
                disabled={locked}
                aria-current={index === activeIndex ? 'step' : undefined}
                onClick={() => goTo(index)}
              >
                <span className="rail-index">{done ? <Check /> : locked ? <LockKeyhole /> : index + 1}</span>
                <span><strong>{step.label}</strong><small>{done ? 'Complete' : locked ? 'Finish previous step' : 'Ready for you'}</small></span>
                <Icon />
              </Button>
            })}
          </nav>
          <div className="rail-safety"><ShieldCheck /><span><strong>Safe preview</strong>No account needed. No personal data is used, and nothing is sent to external services.</span></div>
        </aside>

        <section className="task-column" aria-live="polite">
          {showCompletion
            ? <Completion onOpenLive={onOpenLive} onRestart={restart} />
            : <>
              <header className="task-heading">
                <div><span>STEP {String(activeIndex + 1).padStart(2, '0')} · KAPOOR FAMILY / MYSURU TRIP</span><h1>{active.task}</h1><p>{active.guide}</p></div>
                <RunState state={runState} />
              </header>
              <div className="mobile-step-select">
                <label htmlFor="mobile-journey-step">Journey step</label>
                <Select value={String(activeIndex)} onValueChange={(value) => goTo(Number(value))}><SelectTrigger id="mobile-journey-step" className="mobile-step-trigger"><SelectValue /></SelectTrigger><SelectContent>{steps.map((step, index) => <SelectItem key={step.id} value={String(index)} disabled={index > completed.length}>{index + 1}. {step.label}{index > completed.length ? ' · locked' : ''}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="task-stage" key={`${active.id}-${restartGeneration}`}>
                {active.id === 'inbox' && <InboxTask done={isComplete} setRunning={() => setRunState('running')} onComplete={completeStep} />}
                {active.id === 'language' && <LanguageTask done={isComplete} onComplete={completeStep} />}
                {active.id === 'memory' && <MemoryTask done={isComplete} onComplete={completeStep} />}
                {active.id === 'research' && <ResearchTask done={isComplete} setRunning={() => setRunState('running')} onComplete={completeStep} />}
                {active.id === 'handoff' && <HandoffTask done={isComplete} onComplete={completeStep} />}
                {active.id === 'approval' && <ApprovalTask done={isComplete} onComplete={completeStep} />}
                {active.id === 'privacy' && <PrivacyTask done={isComplete} onComplete={completeStep} />}
              </div>
            </>}
        </section>

        <aside className="evidence-panel" aria-label="Agent run evidence">
          <header><span>RUN TELEMETRY</span><h2>{runState === 'complete' ? 'Step verified' : runState === 'running' ? 'Agent working' : 'Waiting for you'}</h2></header>
          <div className="telemetry-cells">
            <span><small>STATE</small><strong className={runState}>{runState.toUpperCase()}</strong></span>
            <span><small>RUN</small><strong>SIM-{activeIndex + 1}04</strong></span>
          </div>
          <ol className="run-trace">
            <Trace done title="Context scoped" detail="Kapoor family · trip room" />
            <Trace done={runState !== 'waiting'} active={runState === 'running'} title={active.label} detail={active.route} />
            <Trace done={runState === 'complete'} held={runState !== 'complete'} title={runState === 'complete' ? 'Result verified' : 'Awaiting interaction'} detail={runState === 'complete' ? 'Ready for next step' : 'Nothing advances without you'} />
          </ol>
          <section className="provider-block"><span>ROUTE</span><code>{active.route}</code><div>{active.providers.map((provider) => <b key={provider}>{provider}</b>)}</div></section>
          <section className="boundary-block"><ShieldCheck /><div><strong>Boundary in this step</strong><p>{boundaries[active.id]}</p></div></section>
          <footer><Check /><span><strong>Implemented capability</strong>Interactions here are simulated; architecture claims reflect the repository.</span></footer>
        </aside>
      </div>

      {!showCompletion && <footer className="onboarding-controls">
          <Button variant="bare" size="content" className="restart-button" type="button" onClick={restart}><RefreshCcw /> Restart</Button>
          <span id="next-step-hint">{isComplete ? 'Task complete. Continue when ready.' : 'Complete this task to continue.'}</span>
          <div>
            <Button variant="outline" type="button" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}><ArrowLeft /> Back</Button>
            <Button className="next-button" type="button" onClick={() => goTo(activeIndex + 1)} disabled={!isComplete || activeIndex === steps.length - 1} aria-describedby="next-step-hint">Next step <ArrowRight /></Button>
          </div>
        </footer>}
    </main>
  )
}

function RunState({ state }: { state: 'waiting' | 'running' | 'complete' }) {
  return <span className={`run-state ${state}`} role="status"><i /> {state === 'complete' ? 'COMPLETE' : state === 'running' ? 'RUNNING' : 'WAITING'}</span>
}

function Trace({ done, active, held, title, detail }: { done?: boolean; active?: boolean; held?: boolean; title: string; detail: string }) {
  return <li className={done ? 'done' : active ? 'active' : held ? 'held' : ''}><span>{done ? <Check /> : held ? <CircleStop /> : <i />}</span><div><strong>{title}</strong><small>{detail}</small></div></li>
}

function ActionButton({ done, busy = false, onClick, children }: { done: boolean; busy?: boolean; onClick: () => void; children: ReactNode }) {
  return <Button type="button" className={`task-action ${done ? 'done' : ''}`} onClick={onClick} disabled={done || busy}>{done ? <><Check /> Task complete</> : children}</Button>
}

function InboxTask({ done, setRunning, onComplete }: { done: boolean; setRunning: () => void; onComplete: () => void }) {
  const [processing, setProcessing] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  const process = () => {
    if (processing) return
    setProcessing(true)
    setRunning()
    timer.current = window.setTimeout(() => { setProcessing(false); onComplete() }, 650)
  }
  return <div className="task-two-up">
    <article className="task-card source-card">
      <CardLabel icon={<Mail />} label="ORIGINAL EMAIL" />
      <h2>Mysuru field trip — payment due</h2><small>Greenwood School · Today, 9:14 AM</small>
      <div className="email-body"><p>Dear parents,</p><p>Please complete the field-trip payment of <b>₹18,500</b> by <b>24 September</b>. The bus leaves school at 6:30&nbsp;AM.</p><p>Regards,<br />Trip coordinator</p></div>
      <span className="source-proof"><FileText /> Source preserved in the family inbox</span>
    </article>
    <article className="task-card result-card">
      <CardLabel icon={<Sparkles />} label="EMAIL DETAILS" />
      <h2>{processing ? 'Reading the email…' : done ? 'Details ready to review' : 'Ready to read the email'}</h2>
      {done ? <dl className="data-grid"><div><dt>Category</dt><dd>School & family</dd></div><div><dt>Amount</dt><dd>₹18,500</dd></div><div><dt>Due date</dt><dd>24 September</dd></div><div><dt>Next step</dt><dd>Review payment</dd></div></dl> : <div className={`empty-result ${processing ? 'processing' : ''}`}><Inbox /><span>{processing ? 'Finding email details…' : 'No details yet'}</span></div>}
      <ActionButton done={done} busy={processing} onClick={process}><Sparkles />{processing ? ' Finding amount and due date…' : ' Find amount and due date'}</ActionButton>
    </article>
  </div>
}

const translations = {
  en: { label: 'English', text: 'The school trip payment is due by 24 September.' },
  hi: { label: 'हिन्दी', text: 'स्कूल यात्रा का भुगतान 24 सितंबर तक करना है।' },
  mr: { label: 'मराठी', text: 'शाळेच्या सहलीचे पैसे २४ सप्टेंबरपर्यंत भरायचे आहेत.' },
}

function LanguageTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [language, setLanguage] = useState<keyof typeof translations | null>(done ? 'en' : null)
  const choose = (next: keyof typeof translations) => { setLanguage(next); onComplete() }
  return <div className="language-task">
    <article className="task-card original-message"><CardLabel icon={<Languages />} label="ORIGINAL · HINDI" /><div className="message-head"><span>AP</span><div><strong>Appa</strong><small>10:44 · same family conversation</small></div></div><p lang="hi">स्कूल ट्रिप का भुगतान चौबीस सितंबर तक करना है।</p></article>
    <div className="choice-panel"><span>READ THIS AS</span><h2>Choose Asha’s view</h2><div>{(Object.keys(translations) as Array<keyof typeof translations>).map((id) => <Button variant="outline" type="button" className={language === id ? 'selected' : ''} key={id} aria-pressed={language === id} onClick={() => choose(id)}><span aria-hidden="true">{language === id ? <Check /> : null}</span>{translations[id].label}</Button>)}</div><small>Names, dates, amounts, and source links stay unchanged.</small></div>
    <article className={`task-card translated-message ${language ? 'visible' : ''}`}><CardLabel icon={<Sparkles />} label="SAATHI · READER VIEW" /><div className="message-head"><span className="saathi-avatar">स</span><div><strong>Saathi</strong><small>{language ? `Translated to ${translations[language].label}` : 'Waiting for your choice'}</small></div></div><p>{language ? translations[language].text : 'Choose a reading language to create this view.'}</p></article>
  </div>
}

function MemoryTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  return <div className="task-two-up">
    <article className="task-card memory-request"><CardLabel icon={<WandSparkles />} label="MESSAGE TO SAATHI" /><div className="user-prompt">Remember that Appa prefers morning appointments and needs step-free access.</div><div className="jev-route"><header><span>PREFERENCE TO SAVE</span><b>Ready to save</b></header><div><i /></div><small>Save the preference you asked Saathi to remember.</small></div><ActionButton done={done} onClick={onComplete}><MemoryStick /> Save family preference</ActionButton></article>
    <article className="task-card memory-vault"><CardLabel icon={<Brain />} label="SAVED IN THIS CHAT" /><h2>Saved family preferences</h2><div className={`memory-record ${done ? 'new' : ''}`}><span>PREFERENCE</span><p>{done ? 'Appa prefers morning appointments and needs step-free access.' : 'Family prefers vegetarian restaurants.'}</p><small>{done ? 'Added just now · Kapoor family / trip room' : 'Updated 8 days ago · Kapoor family / trip room'}</small></div><div className="memory-record"><span>IF A PREFERENCE CHANGES</span><p>What you say now takes priority over an outdated preference.</p></div></article>
  </div>
}

const citations = [
  { id: 'traffic', title: 'Karnataka traffic advisory', kind: 'Official source', provenance: 'Karnataka State Police · sample source', excerpt: 'Weekend traffic is expected to remain lighter before 8 AM, with intermittent restrictions near Mandya.' },
  { id: 'weather', title: 'IMD weather outlook', kind: 'Official source', provenance: 'India Meteorological Department · sample source', excerpt: 'Mysuru district is forecast to have a dry morning with isolated light showers possible after midday.' },
  { id: 'route', title: 'Route conditions', kind: 'Sample map data', provenance: 'Public route data · sample source', excerpt: 'The primary Bengaluru–Mysuru route is open; construction activity is marked near the Mandya bypass.' },
] as const

function ResearchTask({ done, setRunning, onComplete }: { done: boolean; setRunning: () => void; onComplete: () => void }) {
  const [searched, setSearched] = useState(done)
  const [searching, setSearching] = useState(false)
  const [selectedCitation, setSelectedCitation] = useState<string | null>(done ? citations[0].id : null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  const run = () => {
    if (searching) return
    setSearching(true)
    setRunning()
    timer.current = window.setTimeout(() => { setSearching(false); setSearched(true) }, 600)
  }
  const inspect = (id: string) => { setSelectedCitation(id); onComplete() }
  const selected = citations.find((citation) => citation.id === selectedCitation)
  return <div className="research-task">
    <div className="query-strip"><Search /><div><small>SAMPLE SEARCH QUESTION</small><strong>Current Mysuru road conditions for Saturday morning</strong></div><span>Private names removed</span></div>
    {!searched ? <section className="research-empty"><Globe2 /><h2>{searching ? 'Checking sample sources…' : 'Try a sample web search'}</h2><p>No private family message or memory will be included.</p><Button type="button" onClick={run} disabled={searching}><Search />{searching ? ' Showing sample updates…' : ' Show sample travel updates'}</Button></section> : <div className="research-results"><article className="task-card"><CardLabel icon={<Sparkles />} label="SAMPLE ANSWER" /><h2>This sample suggests an early start.</h2><p>In this example, leaving Bengaluru around 6:30 AM avoids the heavier traffic shown after 8 AM. The sample also marks construction near the Mandya bypass.</p><span className="source-proof"><Check /> 3 sample sources</span>{selected && <div className="citation-detail" role="status"><span>SELECTED SOURCE</span><strong>{selected.title}</strong><p>{selected.excerpt}</p><small>{selected.provenance}</small></div>}</article><section className="citation-list"><span>SOURCES · CHOOSE ONE TO READ</span>{citations.map((citation) => <Button variant="outline" type="button" key={citation.id} className={selectedCitation === citation.id ? 'selected' : ''} onClick={() => inspect(citation.id)}><ExternalLink /><span><strong>{citation.title}</strong><small>{citation.kind} · sample source</small></span>{selectedCitation === citation.id ? <Check /> : <ArrowRight />}</Button>)}</section></div>}
  </div>
}

function HandoffTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [choice, setChoice] = useState<'voice' | 'browser' | null>(done ? 'browser' : null)
  const choose = (next: 'voice' | 'browser') => { setChoice(next); onComplete() }
  return <div className="handoff-task">
    <section className="handoff-brief"><CardLabel icon={<AudioLines />} label="ACTIVE GOAL" /><h2>“Find an accessible Mysuru hotel, but let me sign in.”</h2><p>Review two sample hotels, then choose how to continue.</p></section>
    <div className="handoff-options"><Button variant="outline" type="button" className={choice === 'voice' ? 'selected' : ''} onClick={() => choose('voice')}><Mic /><span><strong>Preview voice option</strong><small>Example: discuss hotels with Saathi</small></span>{choice === 'voice' && <Check />}</Button><Button variant="outline" type="button" className={choice === 'browser' ? 'selected' : ''} onClick={() => choose('browser')}><Monitor /><span><strong>Preview browser option</strong><small>Example: sign in or pay yourself</small></span>{choice === 'browser' && <Check />}</Button></div>
    <section className="browser-preview"><header><Monitor /><span><strong>stay.example / mysuru</strong><small>{choice ? 'HANDOFF READY' : 'READ-ONLY OBSERVATION'}</small></span></header><div className="hotel-result"><i /><span><strong>Garden Courtyard</strong><small>Step-free entrance · family room</small></span><b>₹6,800</b></div><div className="hotel-result"><i /><span><strong>Lakeview House</strong><small>Lift · accessible bathroom</small></span><b>₹7,250</b></div><footer><ShieldCheck /> Saathi stores site cookies, never your password.</footer></section>
  </div>
}

function ApprovalTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [reviewed, setReviewed] = useState(done)
  return <div className="task-two-up approval-task">
    <article className="task-card draft-card"><CardLabel icon={<Mail />} label="DRAFT REPLY · NOT SENT" /><dl className="draft-meta"><div><dt>TO</dt><dd>trips@greenwood-school.example</dd></div><div><dt>SUBJECT</dt><dd>Re: Mysuru field trip</dd></div></dl><div className="draft-body">Hello,<br /><br />Thank you. We have noted the 24 September deadline and will review the ₹18,500 payment tonight.<br /><br />Regards,<br />Asha Kapoor</div><Label className="draft-review" htmlFor="review-sample-send"><Checkbox id="review-sample-send" checked={reviewed} onCheckedChange={(checked) => setReviewed(checked === true)} /> I reviewed the exact recipient and final message</Label></article>
    <article className={`task-card confirmation-gate ${done ? 'confirmed' : ''}`}><ShieldCheck /><span>{done ? 'SIMULATED CONFIRMATION RECORDED' : 'EXTERNAL ACTION PAUSED'}</span><h2>{done ? 'Sample reply confirmed' : 'Review before confirming'}</h2><p>{done ? 'Live mode would save delivery details in this email thread.' : 'Sending requires another permission check and your confirmation of the exact recipient and message.'}</p><Button type="button" onClick={onComplete} disabled={!reviewed || done}>{done ? <><Check /> Confirmed in preview</> : <><Send /> Confirm sample reply</>}</Button><small>Simulation only · no email will be sent</small></article>
  </div>
}

function PrivacyTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [family, setFamily] = useState<'kapoor' | 'rao'>(done ? 'rao' : 'kapoor')
  const switchFamily = () => setFamily('rao')
  return <div className="privacy-task">
    <section className="preview-family-switcher"><span>ACTIVE FAMILY SPACE</span><strong>{family === 'kapoor' ? 'Kapoor family' : 'Rao family'}</strong><Button variant="outline" type="button" onClick={switchFamily} disabled={family === 'rao'}>{family === 'kapoor' ? <><i className="rao" /> Switch to Rao family <ArrowRight /></> : <><Check /> Viewing Rao family</>}</Button><small>One account. Separate access and information for each family.</small></section>
    <section className="scope-view"><header><div><span>{family === 'kapoor' ? 'KF' : 'RF'}</span><div><strong>{family === 'kapoor' ? 'Kapoor family' : 'Rao family'}</strong><small>Sample family space</small></div></div><b>{family === 'kapoor' ? '3 ROOMS · 1 INBOX' : '2 ROOMS · 0 INBOX'}</b></header>{family === 'kapoor' ? <div className="scope-content"><Inbox /><span><strong>Mysuru school trip</strong><small>₹18,500 · 24 September · Greenwood School</small></span></div> : <div className="scope-empty"><LockKeyhole /><h2>The Kapoor trip is not shown here</h2><p>You’re viewing the Rao family example.</p></div>}</section>
    <section className="boundary-check"><ShieldCheck /><div><strong>{family === 'rao' ? 'Check that the Kapoor trip is hidden' : 'Switch to the Rao family first'}</strong><p>In live mode, access is checked separately for each family.</p></div><Button type="button" disabled={family !== 'rao' || done} onClick={onComplete}>{done ? <><Check /> Preview check complete</> : 'Confirm trip is hidden'}</Button></section>
  </div>
}

function CardLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return <div className="card-label">{icon}<span>{label}</span></div>
}

function Completion({ onOpenLive, onRestart }: { onOpenLive: () => void; onRestart: () => void }) {
  return <section className="completion-state">
    <span className="completion-mark"><Check /></span><span>PREVIEW COMPLETE · 7 / 7</span><h1>You’ve finished the preview.</h1><p>Sign in to open your family space. The sample information stays in this preview.</p>
    <div className="completion-grid">{steps.map((step) => { const Icon = step.icon; return <span key={step.id}><Icon /><Check />{step.label}</span> })}</div>
    <div className="completion-actions"><Button type="button" onClick={onOpenLive}>Open live workspace <ArrowRight /></Button><Button variant="outline" type="button" onClick={onRestart}><RefreshCcw /> Restart preview</Button></div>
    <small><ShieldCheck /> Live mode requires sign-in and uses only your authorized family data. Preview data never carries over.</small>
  </section>
}
