import { useEffect, useState, type ComponentType } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  ExternalLink,
  Eye,
  FileText,
  Globe2,
  Inbox,
  Languages,
  Mail,
  MemoryStick,
  Mic,
  Monitor,
  Pause,
  Play,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  WandSparkles,
} from 'lucide-react'
import './PreviewWorkspace.css'

type ChapterId = 'inbox' | 'language' | 'memory' | 'research' | 'voice' | 'approval'
type Language = 'en' | 'hi' | 'mr'

type Chapter = {
  id: ChapterId
  label: string
  shortLabel: string
  description: string
  proof: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  providers: string[]
}

const chapters: Chapter[] = [
  {
    id: 'inbox',
    label: 'Family inbox',
    shortLabel: 'Inbox',
    description: 'Turn incoming family email into structured, source-linked work.',
    proof: 'Signed inbound mail → durable workflow → validated extraction',
    icon: Inbox,
    providers: ['AgentMail', 'Convex', 'OpenAI'],
  },
  {
    id: 'language',
    label: 'One family, three languages',
    shortLabel: 'Language',
    description: 'Each person reads the same canonical conversation in their own language.',
    proof: 'Original preserved → translation cached once per language',
    icon: Languages,
    providers: ['Convex', 'OpenRouter'],
  },
  {
    id: 'memory',
    label: 'Memory + Jev',
    shortLabel: 'Memory',
    description: 'Recall explicit family facts while Jev recommends the safest route.',
    proof: 'Room-scoped memory → Jev route → authorized Pi tools',
    icon: Brain,
    providers: ['TypeSafe Jev', 'Pi', 'Convex'],
  },
  {
    id: 'research',
    label: 'Current, cited research',
    shortLabel: 'Research',
    description: 'Research the public web without sending private family content.',
    proof: 'Public query only → fresh sources → citations saved with answer',
    icon: Globe2,
    providers: ['Firecrawl', 'Pi', 'OpenRouter'],
  },
  {
    id: 'voice',
    label: 'Voice + live browser',
    shortLabel: 'Voice',
    description: 'Move naturally from speech to safe browser actions and human handoff.',
    proof: 'GPT Live → page-derived actions → Jev browser decision',
    icon: AudioLines,
    providers: ['OpenAI', 'Jev', 'Pi'],
  },
  {
    id: 'approval',
    label: 'Draft, then confirm',
    shortLabel: 'Approval',
    description: 'Keep consequential actions behind a clear human decision.',
    proof: 'Draft separated from execution → permission rechecked → idempotent send',
    icon: ShieldCheck,
    providers: ['Convex', 'AgentMail'],
  },
]

const traces: Record<ChapterId, Array<{ title: string; detail: string; state: 'done' | 'active' | 'held' }>> = {
  inbox: [
    { title: 'Inbound verified', detail: 'AgentMail message ID deduplicated', state: 'done' },
    { title: 'Fields extracted', detail: '₹18,500 · 24 Sep · school', state: 'done' },
    { title: 'Action held', detail: 'Nothing is sent automatically', state: 'held' },
  ],
  language: [
    { title: 'Original stored', detail: 'Hindi remains canonical', state: 'done' },
    { title: 'Reader view resolved', detail: 'English for Asha', state: 'active' },
    { title: 'Translation cached', detail: 'Reused for the next reader', state: 'done' },
  ],
  memory: [
    { title: 'Intent classified', detail: 'memory · 94% confidence', state: 'done' },
    { title: 'Fact stored', detail: 'Explicit, room-scoped memory', state: 'active' },
    { title: 'Pi continues', detail: 'Authorized tools remain available', state: 'done' },
  ],
  research: [
    { title: 'Query sanitized', detail: 'No private household text leaves Saathi', state: 'done' },
    { title: 'Public web searched', detail: '3 current sources retrieved', state: 'active' },
    { title: 'Evidence attached', detail: 'URLs and retrieval times saved', state: 'done' },
  ],
  voice: [
    { title: 'Speech understood', detail: 'Live transcript stays in the room', state: 'done' },
    { title: 'Page observed', detail: 'Safe actions derived from page state', state: 'active' },
    { title: 'Human handoff', detail: 'Login and confirmation stay with you', state: 'held' },
  ],
  approval: [
    { title: 'Draft prepared', detail: 'Recipient and final body are visible', state: 'done' },
    { title: 'Permission checked', detail: 'Room participant may send', state: 'done' },
    { title: 'Awaiting confirmation', detail: 'External action is paused', state: 'held' },
  ],
}

export function PreviewWorkspace({ onExit }: { onExit: () => void }) {
  const [activeId, setActiveId] = useState<ChapterId>('inbox')
  const [isPlaying, setIsPlaying] = useState(false)
  const activeIndex = chapters.findIndex((chapter) => chapter.id === activeId)
  const active = chapters[activeIndex]

  const move = (direction: -1 | 1) => {
    const nextIndex = (activeIndex + direction + chapters.length) % chapters.length
    setActiveId(chapters[nextIndex].id)
  }

  useEffect(() => {
    if (!isPlaying) return
    const timer = window.setTimeout(() => {
      setActiveId(chapters[(activeIndex + 1) % chapters.length].id)
    }, 7_000)
    return () => window.clearTimeout(timer)
  }, [activeIndex, isPlaying])

  useEffect(() => {
    const pauseWhenHidden = () => document.hidden && setIsPlaying(false)
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
  }, [])

  return (
    <main className="preview-showroom">
      <header className="preview-tourbar">
        <button className="preview-back" type="button" onClick={onExit}><ArrowLeft /> <span>Exit workspace</span></button>
        <div className="preview-tour-title">
          <span><Sparkles /> Agent workspace</span>
          <strong>{active.label}</strong>
          <small>{String(activeIndex + 1).padStart(2, '0')} / {String(chapters.length).padStart(2, '0')}</small>
        </div>
        <div className="preview-tour-progress" aria-hidden="true"><i style={{ transform: `scaleX(${(activeIndex + 1) / chapters.length})` }} /></div>
        <div className="preview-tour-actions">
          <button type="button" onClick={() => move(-1)} aria-label="Previous workflow"><ChevronLeft /></button>
          <button type="button" className="preview-play" onClick={() => setIsPlaying((value) => !value)}>{isPlaying ? <Pause /> : <Play fill="currentColor" />}<span>{isPlaying ? 'Pause run' : 'Run workflow'}</span></button>
          <button type="button" onClick={() => move(1)} aria-label="Next workflow"><ChevronRight /></button>
        </div>
      </header>

      <section className="preview-showroom-grid">
        <aside className="preview-chapters" aria-label="Preview capabilities">
          <div className="preview-brand"><span>स</span><div><strong>Saathi</strong><small>Family operations, understood</small></div></div>
          <p className="preview-chapters-intro">Choose what to inspect. Every scene uses fictional data and mirrors a shipped workflow.</p>
          <nav>
            {chapters.map((chapter) => {
              const Icon = chapter.icon
              return <button
                type="button"
                key={chapter.id}
                className={activeId === chapter.id ? 'active' : ''}
                aria-current={activeId === chapter.id ? 'page' : undefined}
                onClick={() => { setIsPlaying(false); setActiveId(chapter.id) }}
              >
                <Icon />
                <span><strong>{chapter.label}</strong><small>{chapter.providers.join(' · ')}</small></span>
                <ArrowRight />
              </button>
            })}
          </nav>
          <div className="preview-data-note"><Eye /><span><strong>Safe to explore</strong>Seeded data only. No account, email, or external action.</span></div>
        </aside>

        <section className="preview-stage" aria-live="polite">
          <header className="preview-stage-header">
            <div>
              <span className="preview-family"><i /> Kapoor family · Mysuru school trip</span>
              <h1>{active.label}</h1>
              <p>{active.description}</p>
              <div className="preview-mobile-proof"><span>{active.proof}</span><small>{active.providers.join(' · ')}</small></div>
            </div>
            <span className={`preview-run-state ${isPlaying ? 'running' : ''}`} role="status">
              <i aria-hidden="true" />
              {isPlaying ? 'Agent run active' : 'Run ready'}
            </span>
          </header>
          <div className="preview-stage-body" key={activeId}>
            {activeId === 'inbox' && <InboxScene />}
            {activeId === 'language' && <LanguageScene />}
            {activeId === 'memory' && <MemoryScene />}
            {activeId === 'research' && <ResearchScene />}
            {activeId === 'voice' && <VoiceScene />}
            {activeId === 'approval' && <ApprovalScene />}
          </div>
        </section>

        <aside className="preview-proof" aria-label="How this capability works">
          <header><span>Agent run</span><h2>{isPlaying ? 'Running workflow' : 'Ready to inspect'}</h2><p>{active.proof}</p></header>
          <div className="preview-run-meta" aria-label="Preview run status">
            <span><small>State</small><strong>{isPlaying ? 'RUNNING' : 'READY'}</strong></span>
            <span><small>Step</small><strong>{String(activeIndex + 1).padStart(2, '0')} / {String(chapters.length).padStart(2, '0')}</strong></span>
          </div>
          <div className="preview-trace">
            {traces[activeId].map((item, index) => <div className={`preview-trace-row ${item.state}`} key={item.title}>
              <span className="trace-index">{item.state === 'done' ? <Check /> : item.state === 'held' ? <CircleStop /> : <i />}</span>
              <div><strong>{item.title}</strong><small>{item.detail}</small></div>
              {index < traces[activeId].length - 1 && <b />}
            </div>)}
          </div>
          <section className="preview-provider-section"><span>Running on</span><div>{active.providers.map((provider) => <strong key={provider}>{provider}</strong>)}</div></section>
          <section className="preview-boundary"><ShieldCheck /><div><strong>Boundary stays visible</strong><p>{boundaryCopy(activeId)}</p></div></section>
          <footer><span><Check /> Implemented in the live workspace</span><small>Preview interactions are simulated; product claims reflect repository behavior.</small></footer>
        </aside>
      </section>

      <nav className="preview-mobile-tabs" aria-label="Preview capabilities">
        {chapters.map((chapter) => {
          const Icon = chapter.icon
          return <button type="button" key={chapter.id} className={activeId === chapter.id ? 'active' : ''} onClick={() => { setIsPlaying(false); setActiveId(chapter.id) }}><Icon /><span>{chapter.shortLabel}</span></button>
        })}
      </nav>
    </main>
  )
}

function InboxScene() {
  const [processed, setProcessed] = useState(true)
  return <div className="scene-inbox">
    <article className="source-email">
      <header><span className="source-icon"><Mail /></span><div><small>Original email · AgentMail</small><strong>Mysuru field trip — payment due</strong><span>Greenwood School · Today, 9:14 AM</span></div></header>
      <div className="email-copy"><p>Dear parents,</p><p>Please complete the field-trip payment of <strong>₹18,500</strong> by <strong>24 September</strong>. The bus leaves school at 6:30 AM.</p><p>Regards,<br />Trip coordinator</p></div>
      <footer><FileText /> Original source preserved</footer>
    </article>
    <div className="scene-transfer" aria-hidden="true"><i /><Sparkles /><i /></div>
    <article className={`extraction-sheet ${processed ? 'ready' : 'processing'}`}>
      <header><div><small>Saathi extracted</small><h2>{processed ? 'Ready for the family' : 'Reading the email…'}</h2></div><span>{processed ? <Check /> : <Sparkles />}</span></header>
      {processed ? <>
        <dl><div><dt>Category</dt><dd>School & family</dd></div><div><dt>Amount</dt><dd>₹18,500</dd></div><div><dt>Due date</dt><dd>24 September</dd></div><div><dt>Next step</dt><dd>Review payment</dd></div></dl>
        <div className="extraction-confidence"><span>Validated structured extraction</span><strong>High confidence</strong></div>
      </> : <div className="preview-processing"><i /><i /><i /></div>}
      <button type="button" onClick={() => { setProcessed(false); window.setTimeout(() => setProcessed(true), 900) }} disabled={!processed}>{processed ? 'Replay processing' : 'Processing safely…'}</button>
    </article>
    <section className="scene-run-log" aria-label="Agent run log">
      <header><span>Run log</span><strong>agentmail.inbound → inbox.extract → action.hold</strong></header>
      <ol>
        <li><time>09:14:02</time><i className="complete" /><span><strong>Inbound verified</strong><small>Message ID accepted and deduplicated</small></span></li>
        <li><time>09:14:03</time><i className="complete" /><span><strong>Fields extracted</strong><small>Amount, due date, and category validated</small></span></li>
        <li><time>09:14:04</time><i /><span><strong>Awaiting command</strong><small>External action remains held for review</small></span></li>
      </ol>
    </section>
  </div>
}

function LanguageScene() {
  const [language, setLanguage] = useState<Language>('en')
  const translations: Record<Language, { label: string; text: string; reply: string }> = {
    en: { label: 'English', text: 'The school trip payment is due by 24 September. Should I add it to our family list?', reply: 'Yes, add it. I’ll review the amount tonight.' },
    hi: { label: 'हिन्दी', text: 'स्कूल यात्रा का भुगतान 24 सितंबर तक करना है। क्या मैं इसे परिवार की सूची में जोड़ दूँ?', reply: 'हाँ, जोड़ दो। मैं आज रात राशि देख लूँगी।' },
    mr: { label: 'मराठी', text: 'शाळेच्या सहलीचे पैसे २४ सप्टेंबरपर्यंत भरायचे आहेत. कुटुंबाच्या यादीत टाकू का?', reply: 'हो, टाक. मी आज रात्री रक्कम तपासते.' },
  }
  return <div className="scene-language">
    <div className="language-switch" aria-label="Reading language">{(['en', 'hi', 'mr'] as const).map((id) => <button type="button" className={language === id ? 'active' : ''} onClick={() => setLanguage(id)} key={id}>{translations[id].label}</button>)}</div>
    <div className="language-conversation">
      <article className="language-message incoming"><span className="scene-avatar">AP</span><div><header><strong>Appa</strong><small>Hindi original · 10:44</small></header><p lang="hi">स्कूल ट्रिप का भुगतान चौबीस सितंबर तक करना है।</p><button type="button"><Volume2 /> Listen to original</button></div></article>
      <div className="translation-link"><Languages /><span>Translated for Asha · {translations[language].label}</span></div>
      <article className="language-message assistant"><span className="scene-avatar saathi">स</span><div><header><strong>Saathi</strong><small>reader-language view</small></header><p>{translations[language].text}</p><small>Names, dates, amounts, and source links stay unchanged.</small></div></article>
      <article className="language-message outgoing"><div><header><strong>You</strong><small>same conversation</small></header><p>{translations[language].reply}</p></div></article>
    </div>
  </div>
}

function MemoryScene() {
  const [remembered, setRemembered] = useState(false)
  return <div className="scene-memory">
    <section className="memory-conversation">
      <div className="memory-prompt"><span>You</span><p>Remember that Appa prefers morning appointments and needs step-free access.</p></div>
      <div className="jev-decision"><header><span><WandSparkles /> Jev recommendation</span><strong>memory</strong></header><div><i style={{ width: '94%' }} /><span>94%</span></div><small>Concrete request · no clarification needed</small></div>
      <button type="button" className={remembered ? 'remembered' : ''} onClick={() => setRemembered(true)}>{remembered ? <><Check /> Remembered for this room</> : <><MemoryStick /> Store explicit memory</>}</button>
    </section>
    <section className="memory-vault">
      <header><div><span>Saathi memory</span><h2>Recalled data, never instructions</h2></div><Brain /></header>
      <div className={`memory-fact ${remembered ? 'new' : ''}`}><span>Preference</span><p>{remembered ? 'Appa prefers morning appointments and needs step-free access.' : 'Family prefers vegetarian restaurants.'}</p><small>{remembered ? 'Added just now · room-scoped' : 'Updated 8 days ago · room-scoped'}</small></div>
      <div className="memory-fact"><span>Recent episode</span><p>Compared three Mysuru stays and kept the accessible option.</p><small>Conversation outcome · bounded recall</small></div>
      <footer><ShieldCheck /> Current conversation wins if memory is stale.</footer>
    </section>
  </div>
}

function ResearchScene() {
  const [searched, setSearched] = useState(true)
  return <div className="scene-research">
    <div className="research-question"><Search /><div><small>Public question sent to Firecrawl</small><strong>Current Mysuru road conditions for Saturday morning</strong></div><span>Private names removed</span></div>
    <article className={`research-answer ${searched ? 'ready' : 'loading'}`}>
      <header><span className="scene-avatar saathi">स</span><div><strong>Saturday morning is the calmer window.</strong><small>{searched ? 'Checked 3 current sources · retrieved today' : 'Searching current public sources…'}</small></div></header>
      {searched ? <>
        <p>Leave Bengaluru around 6:30 AM. Current advisories show lighter traffic before 8 AM, with construction near the Mandya bypass.</p>
        <div className="source-list"><a href="https://www.karnataka.gov.in/" target="_blank" rel="noreferrer"><ExternalLink /> Karnataka traffic advisory <span>Official</span></a><a href="https://mausam.imd.gov.in/" target="_blank" rel="noreferrer"><ExternalLink /> IMD weather outlook <span>Official</span></a><a href="https://www.google.com/maps" target="_blank" rel="noreferrer"><ExternalLink /> Route conditions <span>Current</span></a></div>
      </> : <div className="research-loading"><i /><i /><i /></div>}
    </article>
    <button className="research-replay" type="button" disabled={!searched} onClick={() => { setSearched(false); window.setTimeout(() => setSearched(true), 1000) }}>{searched ? 'Replay cited research' : 'Searching without private context…'}</button>
  </div>
}

function VoiceScene() {
  const [running, setRunning] = useState(false)
  return <div className="scene-voice">
    <section className="voice-presence">
      <div className={`preview-voice-orb ${running ? 'listening' : ''}`}><i /><b /><span><Mic /></span></div>
      <div><span>{running ? 'Listening' : 'Voice preview paused'}</span><h2>“Find an accessible Mysuru hotel, but let me sign in.”</h2><p>Live speech, tool activity, and handoffs remain in the same family conversation.</p></div>
      <button type="button" onClick={() => setRunning((value) => !value)}>{running ? <><CircleStop /> Pause simulation</> : <><Mic /> Simulate voice request</>}</button>
    </section>
    <section className="browser-handoff">
      <header><Monitor /><div><strong>Live browser handoff</strong><small>Jev chooses from page-derived safe actions</small></div><span>{running ? 'Observing page' : 'Ready'}</span></header>
      <div className="browser-frame">
        <div className="browser-chrome"><i /><i /><i /><span>stay.example/mysuru</span></div>
        <div className="hotel-row"><div /><span><strong>Garden Courtyard</strong><small>Step-free entrance · family room</small></span><b>₹6,800</b></div>
        <div className="hotel-row"><div /><span><strong>Lakeview House</strong><small>Lift · accessible bathroom</small></span><b>₹7,250</b></div>
      </div>
      <footer><ShieldCheck /><span><strong>Your turn for sign-in or payment</strong><small>Saathi keeps site cookies, never your password.</small></span></footer>
    </section>
  </div>
}

function ApprovalScene() {
  const [confirmed, setConfirmed] = useState(false)
  return <div className="scene-approval">
    <section className="approval-draft">
      <header><div><span>Draft reply</span><h2>Everything visible before it leaves</h2></div><Mail /></header>
      <dl><div><dt>To</dt><dd>trips@greenwood-school.example</dd></div><div><dt>Subject</dt><dd>Re: Mysuru field trip</dd></div></dl>
      <div className="draft-body">Hello,<br /><br />Thank you. We have noted the 24 September deadline and will review the ₹18,500 payment tonight.<br /><br />Regards,<br />Asha Kapoor</div>
      <small><FileText /> Seeded recipient and body · no real email address</small>
    </section>
    <section className={`approval-gate ${confirmed ? 'confirmed' : ''}`}>
      <div className="approval-lock"><ShieldCheck /></div>
      <span>{confirmed ? 'Confirmation recorded' : 'External action paused'}</span>
      <h2>{confirmed ? 'Sample reply marked as sent' : 'Only you can send this reply'}</h2>
      <p>{confirmed ? 'In live mode, AgentMail delivery metadata would be saved to the same thread.' : 'Saathi can draft, but sending requires a fresh permission check and your explicit confirmation.'}</p>
      <button type="button" onClick={() => setConfirmed(true)} disabled={confirmed}>{confirmed ? <><Check /> Confirmed in preview</> : <><Send /> Confirm sample send</>}</button>
      {!confirmed && <small>Preview only · nothing will be sent</small>}
    </section>
  </div>
}

function boundaryCopy(id: ChapterId) {
  if (id === 'inbox') return 'The original email remains visible beside every extracted field.'
  if (id === 'language') return 'Translation changes the reader view, never the canonical family record.'
  if (id === 'memory') return 'Memory is explicit, bounded, room-scoped, and treated as potentially stale.'
  if (id === 'research') return 'Only a public search question reaches Firecrawl; private family text stays behind.'
  if (id === 'voice') return 'Login, payment, and consequential browser steps return control to the person.'
  return 'Drafting and execution are separate operations with fresh authorization.'
}
