import { useState, type ComponentType, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Brain,
  Check,
  ChevronDown,
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
  { id: 'inbox', label: 'Extract family email', task: 'Turn a school note into trusted work', guide: 'Review the source, then ask Saathi to extract the details that matter.', icon: Inbox, route: 'agentmail.inbound → inbox.extract', providers: ['AgentMail', 'OpenAI', 'Convex'] },
  { id: 'language', label: 'Translate the conversation', task: 'Let everyone read in their language', guide: 'Choose how Asha should read Appa’s original message.', icon: Languages, route: 'message.original → translation.cache', providers: ['OpenRouter', 'Convex'] },
  { id: 'memory', label: 'Guide Saathi + Jev', task: 'Save one useful family preference', guide: 'Inspect Jev’s route, then explicitly decide whether this fact should be remembered.', icon: Brain, route: 'jev.route → agent.memory', providers: ['TypeSafe Jev', 'Pi', 'Convex'] },
  { id: 'research', label: 'Research with citations', task: 'Check current public information', guide: 'Run a privacy-safe web query, then inspect one retrieved source.', icon: Globe2, route: 'query.sanitize → firecrawl.search', providers: ['Firecrawl', 'Pi', 'OpenRouter'] },
  { id: 'handoff', label: 'Try voice + live browser', task: 'Choose the right human handoff', guide: 'Pick a way to continue. Sign-in and payment always return to you.', icon: AudioLines, route: 'voice.intent → jev.browser → handoff', providers: ['OpenAI Live', 'Jev', 'Firecrawl'] },
  { id: 'approval', label: 'Review and confirm', task: 'Approve the exact draft, not an idea', guide: 'Inspect the recipient and final body before confirming the simulated send.', icon: ShieldCheck, route: 'draft.create → permission.check → confirm', providers: ['AgentMail', 'Convex'] },
  { id: 'privacy', label: 'Verify family boundaries', task: 'Switch spaces without carrying data over', guide: 'Move to another family and verify the Kapoor trip disappears from scope.', icon: LockKeyhole, route: 'space.switch → subscription.replace', providers: ['Convex Auth', 'Convex'] },
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
  const active = steps[activeIndex]
  const isComplete = completed.includes(active.id)
  const journeyComplete = completed.length === steps.length

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
  }

  return (
    <main className={`onboarding-shell ${journeyComplete ? 'journey-complete' : ''}`}>
      <header className="onboarding-topbar">
        <button className="topbar-exit" type="button" onClick={onExit}><ArrowLeft /><span>Exit preview</span></button>
        <div className="topbar-title"><span>Saathi onboarding</span><b>Kapoor family journey</b></div>
        <span className="simulation-badge"><Eye /> SIMULATION · SAMPLE DATA</span>
        <div className="topbar-progress" aria-label={`${completed.length} of ${steps.length} steps complete`}>
          <span>{String(Math.min(activeIndex + 1, steps.length)).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span>
          <i><b style={{ width: `${(completed.length / steps.length) * 100}%` }} /></i>
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
              return <button
                type="button"
                key={step.id}
                className={`${index === activeIndex ? 'active' : ''} ${done ? 'done' : ''}`}
                disabled={locked}
                aria-current={index === activeIndex ? 'step' : undefined}
                onClick={() => goTo(index)}
              >
                <span className="rail-index">{done ? <Check /> : locked ? <LockKeyhole /> : index + 1}</span>
                <span><strong>{step.label}</strong><small>{done ? 'Complete' : locked ? 'Finish previous step' : 'Ready for you'}</small></span>
                <Icon />
              </button>
            })}
          </nav>
          <div className="rail-safety"><ShieldCheck /><span><strong>Safe preview</strong>No account, personal data, provider calls, or external actions.</span></div>
        </aside>

        <section className="task-column" aria-live="polite">
          {journeyComplete && activeIndex === steps.length - 1 && isComplete
            ? <Completion onOpenLive={onOpenLive} onRestart={restart} />
            : <>
              <header className="task-heading">
                <div><span>STEP {String(activeIndex + 1).padStart(2, '0')} · KAPOOR FAMILY / MYSURU TRIP</span><h1>{active.task}</h1><p>{active.guide}</p></div>
                <RunState state={runState} />
              </header>
              <div className="mobile-step-select">
                <span>Journey step</span><button type="button">{activeIndex + 1}. {active.label}<ChevronDown /></button>
              </div>
              <div className="task-stage" key={active.id}>
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

      {!journeyComplete && <footer className="onboarding-controls">
          <button className="restart-button" type="button" onClick={restart}><RefreshCcw /> Restart</button>
          <span>{isComplete ? 'Task complete. Continue when ready.' : 'Complete the task to unlock Next.'}</span>
          <div>
            <button type="button" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}><ArrowLeft /> Back</button>
            <button className="next-button" type="button" onClick={() => goTo(activeIndex + 1)} disabled={!isComplete || activeIndex === steps.length - 1}>Next <ArrowRight /></button>
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

function ActionButton({ done, onClick, children }: { done: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`task-action ${done ? 'done' : ''}`} onClick={onClick} disabled={done}>{done ? <><Check /> Task complete</> : children}</button>
}

function InboxTask({ done, setRunning, onComplete }: { done: boolean; setRunning: () => void; onComplete: () => void }) {
  const [processing, setProcessing] = useState(false)
  const process = () => {
    setProcessing(true)
    setRunning()
    window.setTimeout(() => { setProcessing(false); onComplete() }, 650)
  }
  return <div className="task-two-up">
    <article className="task-card source-card">
      <CardLabel icon={<Mail />} label="ORIGINAL EMAIL · AGENTMAIL" />
      <h2>Mysuru field trip — payment due</h2><small>Greenwood School · Today, 9:14 AM</small>
      <div className="email-body"><p>Dear parents,</p><p>Please complete the field-trip payment of <b>₹18,500</b> by <b>24 September</b>. The bus leaves school at 6:30 AM.</p><p>Regards,<br />Trip coordinator</p></div>
      <span className="source-proof"><FileText /> Source preserved in the family inbox</span>
    </article>
    <article className="task-card result-card">
      <CardLabel icon={<Sparkles />} label="STRUCTURED EXTRACTION" />
      <h2>{processing ? 'Reading the email…' : done ? 'Details ready to review' : 'Waiting for your command'}</h2>
      {done ? <dl className="data-grid"><div><dt>Category</dt><dd>School & family</dd></div><div><dt>Amount</dt><dd>₹18,500</dd></div><div><dt>Due date</dt><dd>24 September</dd></div><div><dt>Next step</dt><dd>Review payment</dd></div></dl> : <div className={`empty-result ${processing ? 'processing' : ''}`}><Inbox /><span>{processing ? 'Validating extracted fields' : 'No extraction has run yet'}</span></div>}
      <ActionButton done={done} onClick={process}><Sparkles /> Extract key details</ActionButton>
    </article>
  </div>
}

const translations = {
  en: { label: 'English', text: 'The school trip payment is due by 24 September. Should I add it to our family list?' },
  hi: { label: 'हिन्दी', text: 'स्कूल यात्रा का भुगतान 24 सितंबर तक करना है। क्या मैं इसे परिवार की सूची में जोड़ दूँ?' },
  mr: { label: 'मराठी', text: 'शाळेच्या सहलीचे पैसे २४ सप्टेंबरपर्यंत भरायचे आहेत. कुटुंबाच्या यादीत टाकू का?' },
}

function LanguageTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [language, setLanguage] = useState<keyof typeof translations | null>(done ? 'en' : null)
  const choose = (next: keyof typeof translations) => { setLanguage(next); onComplete() }
  return <div className="language-task">
    <article className="task-card original-message"><CardLabel icon={<Languages />} label="ORIGINAL · HINDI" /><div className="message-head"><span>AP</span><div><strong>Appa</strong><small>10:44 · same family conversation</small></div></div><p lang="hi">स्कूल ट्रिप का भुगतान चौबीस सितंबर तक करना है।</p></article>
    <div className="choice-panel"><span>READ THIS AS</span><h2>Choose Asha’s view</h2><div>{(Object.keys(translations) as Array<keyof typeof translations>).map((id) => <button type="button" className={language === id ? 'selected' : ''} key={id} onClick={() => choose(id)}><span>{language === id ? <Check /> : null}</span>{translations[id].label}</button>)}</div><small>Names, dates, amounts, and source links stay unchanged.</small></div>
    <article className={`task-card translated-message ${language ? 'visible' : ''}`}><CardLabel icon={<Sparkles />} label="SAATHI · READER VIEW" /><div className="message-head"><span className="saathi-avatar">स</span><div><strong>Saathi</strong><small>{language ? `Translated to ${translations[language].label}` : 'Waiting for your choice'}</small></div></div><p>{language ? translations[language].text : 'Choose a reading language to create this view.'}</p></article>
  </div>
}

function MemoryTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  return <div className="task-two-up">
    <article className="task-card memory-request"><CardLabel icon={<WandSparkles />} label="MESSAGE TO SAATHI" /><div className="user-prompt">Remember that Appa prefers morning appointments and needs step-free access.</div><div className="jev-route"><header><span>JEV RECOMMENDATION</span><b>memory · 94%</b></header><div><i /></div><small>Concrete explicit fact · no clarification needed</small></div><ActionButton done={done} onClick={onComplete}><MemoryStick /> Store explicit memory</ActionButton></article>
    <article className="task-card memory-vault"><CardLabel icon={<Brain />} label="ROOM-SCOPED MEMORY" /><h2>Facts, never hidden instructions</h2><div className={`memory-record ${done ? 'new' : ''}`}><span>PREFERENCE</span><p>{done ? 'Appa prefers morning appointments and needs step-free access.' : 'Family prefers vegetarian restaurants.'}</p><small>{done ? 'Added just now · Kapoor family / trip room' : 'Updated 8 days ago · Kapoor family / trip room'}</small></div><div className="memory-record"><span>RECALL POLICY</span><p>Current conversation wins if this memory becomes stale.</p></div></article>
  </div>
}

function ResearchTask({ done, setRunning, onComplete }: { done: boolean; setRunning: () => void; onComplete: () => void }) {
  const [searched, setSearched] = useState(done)
  const [inspected, setInspected] = useState(done)
  const run = () => { setRunning(); window.setTimeout(() => setSearched(true), 600) }
  const inspect = () => { setInspected(true); onComplete() }
  return <div className="research-task">
    <div className="query-strip"><Search /><div><small>SANITIZED PUBLIC QUERY</small><strong>Current Mysuru road conditions for Saturday morning</strong></div><span>Private names removed</span></div>
    {!searched ? <section className="research-empty"><Globe2 /><h2>Ready to check the public web</h2><p>No private family message or memory will be included.</p><button type="button" onClick={run}><Search /> Run cited research</button></section> : <div className="research-results"><article className="task-card"><CardLabel icon={<Sparkles />} label="SAATHI ANSWER" /><h2>Saturday morning is the calmer window.</h2><p>Leave Bengaluru around 6:30 AM. Current advisories show lighter traffic before 8 AM, with construction near the Mandya bypass.</p><span className="source-proof"><Check /> 3 sources retrieved and attached</span></article><section className="citation-list"><span>CITATIONS · SELECT ONE TO INSPECT</span>{['Karnataka traffic advisory', 'IMD weather outlook', 'Route conditions'].map((source, index) => <button type="button" key={source} className={inspected && index === 0 ? 'selected' : ''} onClick={inspect}><ExternalLink /><span><strong>{source}</strong><small>{index < 2 ? 'Official source' : 'Current map data'} · retrieved today</small></span>{inspected && index === 0 ? <Check /> : <ArrowRight />}</button>)}</section></div>}
  </div>
}

function HandoffTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [choice, setChoice] = useState<'voice' | 'browser' | null>(done ? 'browser' : null)
  const choose = (next: 'voice' | 'browser') => { setChoice(next); onComplete() }
  return <div className="handoff-task">
    <section className="handoff-brief"><CardLabel icon={<AudioLines />} label="ACTIVE GOAL" /><h2>“Find an accessible Mysuru hotel, but let me sign in.”</h2><p>Jev has observed two read-only results. Choose how to take control.</p></section>
    <div className="handoff-options"><button type="button" className={choice === 'voice' ? 'selected' : ''} onClick={() => choose('voice')}><Mic /><span><strong>Continue by voice</strong><small>Discuss choices with Saathi Live</small></span>{choice === 'voice' && <Check />}</button><button type="button" className={choice === 'browser' ? 'selected' : ''} onClick={() => choose('browser')}><Monitor /><span><strong>Open live browser</strong><small>Take over for login or payment</small></span>{choice === 'browser' && <Check />}</button></div>
    <section className="browser-preview"><header><Monitor /><span><strong>stay.example / mysuru</strong><small>{choice ? 'HANDOFF READY' : 'READ-ONLY OBSERVATION'}</small></span></header><div className="hotel-result"><i /><span><strong>Garden Courtyard</strong><small>Step-free entrance · family room</small></span><b>₹6,800</b></div><div className="hotel-result"><i /><span><strong>Lakeview House</strong><small>Lift · accessible bathroom</small></span><b>₹7,250</b></div><footer><ShieldCheck /> Saathi stores site cookies, never your password.</footer></section>
  </div>
}

function ApprovalTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [reviewed, setReviewed] = useState(done)
  return <div className="task-two-up approval-task">
    <article className="task-card draft-card"><CardLabel icon={<Mail />} label="DRAFT REPLY · NOT SENT" /><dl className="draft-meta"><div><dt>TO</dt><dd>trips@greenwood-school.example</dd></div><div><dt>SUBJECT</dt><dd>Re: Mysuru field trip</dd></div></dl><div className="draft-body">Hello,<br /><br />Thank you. We have noted the 24 September deadline and will review the ₹18,500 payment tonight.<br /><br />Regards,<br />Asha Kapoor</div><label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed the exact recipient and final body</label></article>
    <article className={`task-card confirmation-gate ${done ? 'confirmed' : ''}`}><ShieldCheck /><span>{done ? 'SIMULATED CONFIRMATION RECORDED' : 'EXTERNAL ACTION PAUSED'}</span><h2>{done ? 'Sample reply marked sent' : 'Only you can send this reply'}</h2><p>{done ? 'In live mode, delivery metadata would be saved to the same thread.' : 'Saathi can draft, but execution requires a fresh permission check and explicit confirmation.'}</p><button type="button" onClick={onComplete} disabled={!reviewed || done}>{done ? <><Check /> Confirmed in preview</> : <><Send /> Confirm sample send</>}</button><small>Simulation only · no email will be sent</small></article>
  </div>
}

function PrivacyTask({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [family, setFamily] = useState<'kapoor' | 'rao'>(done ? 'rao' : 'kapoor')
  const switchFamily = () => setFamily('rao')
  return <div className="privacy-task">
    <section className="family-switcher"><span>ACTIVE FAMILY SPACE</span><button type="button" onClick={switchFamily}><i className={family} />{family === 'kapoor' ? 'Kapoor family' : 'Rao family'}<ChevronDown /></button><small>One account, independent memberships and data scopes.</small></section>
    <section className="scope-view"><header><div><span>{family === 'kapoor' ? 'KF' : 'RF'}</span><div><strong>{family === 'kapoor' ? 'Kapoor family' : 'Rao family'}</strong><small>Authorized workspace</small></div></div><b>{family === 'kapoor' ? '3 ROOMS · 1 INBOX' : '2 ROOMS · 0 INBOX'}</b></header>{family === 'kapoor' ? <div className="scope-content"><Inbox /><span><strong>Mysuru school trip</strong><small>₹18,500 · 24 September · Greenwood School</small></span></div> : <div className="scope-empty"><LockKeyhole /><h2>No Kapoor data in this scope</h2><p>Rooms, inbox subscriptions, search, memory, and model context were replaced together.</p></div>}</section>
    <section className="boundary-check"><ShieldCheck /><div><strong>{family === 'rao' ? 'Boundary ready to verify' : 'Switch to the Rao family first'}</strong><p>The live app authorizes each family independently on the server.</p></div><button type="button" disabled={family !== 'rao' || done} onClick={onComplete}>{done ? <><Check /> Boundary verified</> : 'Verify isolation'}</button></section>
  </div>
}

function CardLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return <div className="card-label">{icon}<span>{label}</span></div>
}

function Completion({ onOpenLive, onRestart }: { onOpenLive: () => void; onRestart: () => void }) {
  return <section className="completion-state">
    <span className="completion-mark"><Check /></span><span>ONBOARDING COMPLETE · 7 / 7</span><h1>You completed one family journey.</h1><p>You turned a school email into translated, remembered, researched, human-approved work—without crossing a family or safety boundary.</p>
    <div className="completion-grid">{steps.map((step) => { const Icon = step.icon; return <span key={step.id}><Icon /><Check />{step.label}</span> })}</div>
    <div className="completion-actions"><button type="button" onClick={onOpenLive}>Open live workspace <ArrowRight /></button><button type="button" onClick={onRestart}><RefreshCcw /> Replay simulation</button></div>
    <small><ShieldCheck /> Live mode requires sign-in and uses only your authorized family data. Preview data never carries over.</small>
  </section>
}
