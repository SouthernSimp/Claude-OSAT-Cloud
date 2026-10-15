import { useMemo, useState } from 'react'
import { ArrowRight, CalendarBlank, CheckCircle, ListChecks, NotePencil, Sparkle, Stack, TreeStructure } from '@phosphor-icons/react'

import { SPACES, TOOLS, SETTINGS } from '../lib/spaces.js'
import { pageById } from './settings/pages.js'
import { dashboard, smoothPath } from './dashboard-model.js'

/* The Dashboard (dock → Dashboard, ⌘6): everything at a glance, the way a good admin dashboard reads. Four numbers,
   a welcome you can ask straight from, how much is sorted, a week of writing, the biggest topics, what's next, and
   every part of OSAT as an app tile, so nothing hides behind Tools. Read-only: it only opens things. The numbers come
   from dashboard-model.js. */

const CARD_LOOKS = { unsorted: [Stack, 'yellow'], topics: [TreeStructure, 'teal'], written: [NotePencil, 'violet'], steps: [ListChecks, 'green'] }

// The settings worth finding from here, as apps of their own.
const SETTING_APPS = ['shortcuts', 'clipboard', 'snippets', 'windows', 'screenshots', 'keyboard', 'ai', 'bots']

export function DashboardView({ workspace, navigate }) {
  const board = useMemo(() => dashboard(workspace, new Date()), [workspace])
  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <small>OSAT <span>/</span> Dashboard</small>
          <h1>Everything, at a glance</h1>
        </div>
        <p>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </header>

      <section className="dash-cards" aria-label="Today in numbers">
        {board.cards.map((card, index) => {
          const [Icon, tint] = CARD_LOOKS[card.id]
          return (
            <button key={card.id} type="button" className="dash-card dash-stat" style={{ '--i': index }} onClick={() => navigate(...card.go)}>
              <span>
                <small>{card.label}</small>
                <b>{card.value.toLocaleString('en-US')} {card.note && <em data-up={card.id === 'written' && card.up ? '' : undefined}>{card.note}</em>}</b>
              </span>
              <i className="tile" data-tint={tint} aria-hidden="true"><Icon weight="fill" /></i>
            </button>
          )
        })}
      </section>

      <section className="dash-row dash-row-hero">
        <Welcome greeting={greeting} navigate={navigate} />
        <Gauge value={board.sorted} stickies={board.stickies} onOpen={() => navigate('Mindmap')} />
        <Habits habits={board.habits} onOpen={() => navigate('Habits')} />
      </section>

      <section className="dash-row dash-row-wide">
        <Writing week={board.week} thisWeek={board.thisWeek} lastWeek={board.lastWeek} />
        <Topics biggest={board.biggest} navigate={navigate} board={board} />
      </section>

      <section className="dash-row dash-row-wide">
        <Everything navigate={navigate} />
        <Next steps={board.steps} soon={board.soon} navigate={navigate} />
      </section>
    </div>
  )
}

/* Welcome back: a glowing card with one field that asks the AI, like the dashboard's "Ask me anything". */
function Welcome({ greeting, navigate }) {
  const [text, setText] = useState('')
  const ask = (event) => {
    event.preventDefault()
    const prompt = text.trim()
    navigate('Assistant', prompt ? { prompt } : null)
    setText('')
  }
  return (
    <article className="dash-card dash-welcome">
      <div className="dash-orb" aria-hidden="true"><i /><i /><i /><Sparkle weight="fill" /></div>
      <div className="dash-welcome-words">
        <small>Welcome back,</small>
        <h2>{greeting}</h2>
        <p>Glad to see you again.<br />Ask me anything.</p>
      </div>
      <form className="dash-ask" onSubmit={ask}>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask about your notes…" aria-label="Ask the AI" />
        <button type="submit" aria-label="Ask"><ArrowRight weight="bold" /></button>
      </form>
      <button type="button" className="dash-link" onClick={() => navigate('Capture')}>Write a sticky <ArrowRight weight="bold" /></button>
    </article>
  )
}

/* How much of what you wrote has a home: an arc, as the reference's satisfaction gauge. */
function Gauge({ value, stickies, onOpen }) {
  const r = 70
  const length = Math.PI * 1.5 * r
  return (
    <button type="button" className="dash-card dash-gauge" onClick={onOpen}>
      <h3>Sorted</h3>
      <small>Stickies with a home</small>
      <div className="dash-dial">
      <svg viewBox="0 0 180 160" aria-hidden="true">
        <defs><linearGradient id="dash-gauge" x1="0" x2="1"><stop offset="0" stopColor="var(--dash-blue)" /><stop offset="1" stopColor="var(--dash-cyan)" /></linearGradient></defs>
        <circle cx="90" cy="88" r={r} className="dash-track" strokeDasharray={`${length} 999`} transform="rotate(135 90 88)" />
        <circle cx="90" cy="88" r={r} className="dash-arc" data-none={value ? undefined : ''} stroke="url(#dash-gauge)" strokeDasharray={`${(length * value) / 100} 999`} transform="rotate(135 90 88)" />
      </svg>
      <span className="dash-gauge-face" aria-hidden="true"><CheckCircle weight="fill" /></span>
      </div>
      <div className="dash-gauge-read">
        <span>0%</span>
        <p><b>{value}%</b><small>of {stickies.toLocaleString('en-US')} stickies</small></p>
        <span>100%</span>
      </div>
    </button>
  )
}

/* Habits kept today, as a ring. */
function Habits({ habits, onOpen }) {
  const share = habits.total ? habits.done / habits.total : 0
  const r = 52
  const round = 2 * Math.PI * r
  return (
    <button type="button" className="dash-card dash-habits" onClick={onOpen}>
      <h3>Habits today</h3>
      <div className="dash-habits-body">
        <div className="dash-mini">
          <div><small>Kept</small><b>{habits.done}</b></div>
          <div><small>To go</small><b>{Math.max(habits.total - habits.done, 0)}</b></div>
        </div>
        <div className="dash-ring">
          <svg viewBox="0 0 130 130" aria-hidden="true">
            <defs><linearGradient id="dash-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--dash-green)" /><stop offset="1" stopColor="var(--dash-cyan)" /></linearGradient></defs>
            <circle cx="65" cy="65" r={r} className="dash-track" />
            <circle cx="65" cy="65" r={r} className="dash-arc" data-none={share ? undefined : ''} stroke="url(#dash-ring)" strokeDasharray={`${round * share} ${round}`} transform="rotate(-90 65 65)" />
          </svg>
          <p>{habits.total ? <><small>Today</small><b>{habits.done}/{habits.total}</b></> : <small>No habits yet</small>}</p>
        </div>
      </div>
    </button>
  )
}

/* A week of writing against the week before: two smooth lines, the newer one filled. */
function Writing({ week, thisWeek, lastWeek }) {
  const now = week.slice(7)
  const before = week.slice(0, 7)
  const top = Math.max(4, ...week.map((day) => day.count))
  const W = 640
  const H = 220
  const x = (index) => 36 + (index * (W - 52)) / 6
  const y = (count) => 14 + (H - 44) * (1 - count / top)
  const line = (days) => smoothPath(days.map((day, index) => [Math.round(x(index)), Math.round(y(day.count))]))
  const area = `${line(now)} L${x(6)},${H - 30} L${x(0)},${H - 30} Z`
  const ticks = [0, Math.round(top / 2), top]
  const diff = thisWeek - lastWeek
  return (
    <article className="dash-card dash-writing">
      <h3>Your writing</h3>
      <small><b data-up={diff >= 0 ? '' : undefined}>{diff >= 0 ? `+${diff}` : diff} {Math.abs(diff) === 1 ? 'sticky' : 'stickies'}</b> against last week</small>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`This week ${thisWeek}, last week ${lastWeek}`}>
        <defs>
          <linearGradient id="dash-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--dash-blue)" stopOpacity="0.55" /><stop offset="1" stopColor="var(--dash-blue)" stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1="36" x2={W - 16} y1={y(tick)} y2={y(tick)} className="dash-grid" />
            <text x="24" y={y(tick) + 4} className="dash-axis" textAnchor="end">{tick}</text>
          </g>
        ))}
        <path d={area} fill="url(#dash-area)" className="dash-area" />
        <path d={line(before)} className="dash-line is-before" />
        <path d={line(now)} className="dash-line" />
        {now.map((day, index) => <text key={day.key} x={x(index)} y={H - 8} className="dash-axis" textAnchor="middle">{new Date(`${day.key}T12:00`).toLocaleDateString('en-US', { weekday: 'short' })}</text>)}
      </svg>
      <p className="dash-legend"><i /> This week <i className="is-before" /> Last week</p>
    </article>
  )
}

/* The biggest topics as bars, and four small numbers under them. */
function Topics({ biggest, navigate, board }) {
  const top = Math.max(1, ...biggest.map((topic) => topic.count))
  const minis = [
    ['Stickies', board.stickies, Stack, 'yellow'],
    ['Topics', board.cards[1].value, TreeStructure, 'teal'],
    ['Next steps', board.cards[3].value, ListChecks, 'green'],
    ['This week', board.thisWeek, NotePencil, 'violet'],
  ]
  return (
    <article className="dash-card dash-topics">
      <div className="dash-bars" role="list" aria-label="Your biggest topics">
        {biggest.length === 0 && <p className="dash-empty">Your topics will stand here.<br />Make one on the canvas.</p>}
        {biggest.map((topic, index) => (
          <button key={topic.id} type="button" role="listitem" className="dash-bar" style={{ '--h': `${Math.max(6, (topic.count / top) * 100)}%`, '--i': index }} title={`${topic.name}: ${topic.count}`} onClick={() => navigate('Mindmap', { folderId: topic.id })}>
            <i /><span>{topic.name}</span>
          </button>
        ))}
      </div>
      <h3>Biggest topics</h3>
      <small>By stickies inside</small>
      <div className="dash-minis">
        {minis.map(([label, value, Icon, tint]) => (
          <div key={label}>
            <span><i className="tile" data-tint={tint} aria-hidden="true"><Icon weight="fill" /></i>{label}</span>
            <b>{value.toLocaleString('en-US')}</b>
            <meter min="0" max={Math.max(value, board.stickies, 1)} value={value} aria-label={label} />
          </div>
        ))}
      </div>
    </article>
  )
}

/* Every part of OSAT as an app tile: the spaces, the tools, and the settings worth finding. */
function Everything({ navigate }) {
  const apps = [
    ...SPACES.filter((space) => space.id !== 'Today' && space.id !== 'Dashboard').map((space) => ({ id: space.id, label: space.label, icon: space.icon, tint: space.tint, hint: space.hint, go: [space.id] })),
    ...TOOLS.map((tool) => ({ id: tool.id, label: tool.label, icon: tool.icon, tint: tool.tint, hint: tool.hint, go: [tool.id] })),
    ...SETTING_APPS.map(pageById).filter(Boolean).map((page) => ({ id: `settings:${page.id}`, label: page.label, icon: page.icon, tint: page.tint, hint: page.blurb, go: [SETTINGS.id, { section: page.id }] })),
    { id: SETTINGS.id, label: SETTINGS.label, icon: SETTINGS.icon, tint: SETTINGS.tint, hint: SETTINGS.hint, go: [SETTINGS.id] },
  ]
  return (
    <article className="dash-card dash-apps">
      <h3>Everything in OSAT</h3>
      <small>{apps.length} things it does. Pick one.</small>
      <div className="dash-app-grid">
        {apps.map((app, index) => (
          <button key={app.id} type="button" className="dash-app" title={app.hint} style={{ '--i': index }} onClick={() => navigate(...app.go)}>
            <i className="tile" data-tint={app.tint || 'indigo'} aria-hidden="true"><app.icon weight="fill" /></i>
            <span>{app.label}</span>
          </button>
        ))}
      </div>
    </article>
  )
}

/* What's next: open next steps, and what's on the calendar soon. */
function Next({ steps, soon, navigate }) {
  return (
    <article className="dash-card dash-next">
      <h3>Up next</h3>
      <small>{steps.length ? `${steps.length} next ${steps.length === 1 ? 'step' : 'steps'} open` : 'Nothing waiting'}</small>
      <ul>
        {soon.map((event) => (
          <li key={event.id}>
            <button type="button" onClick={() => navigate('Calendar', { date: event.start.slice(0, 10) })}>
              <i className="tile" data-tint="red" aria-hidden="true"><CalendarBlank weight="fill" /></i>
              <span><b>{event.title || 'Event'}</b><small>{event.when.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></span>
            </button>
          </li>
        ))}
        {steps.map((step) => (
          <li key={step.id}>
            <button type="button" onClick={() => navigate('Notes', { noteId: step.noteId })}>
              <i className="tile" data-tint="green" aria-hidden="true"><ListChecks weight="fill" /></i>
              <span><b>{step.text}</b><small>{step.noteTitle}</small></span>
            </button>
          </li>
        ))}
        {!steps.length && !soon.length && <li className="dash-empty">A clear runway. Write “- [ ] something” in any note and it shows here.</li>}
      </ul>
    </article>
  )
}
