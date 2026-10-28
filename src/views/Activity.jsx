import { useCallback, useEffect, useState } from 'react'

import { cleanError } from '../assistant/useAi.js'
import { PRESSURE_WORDS, bytesWords, uptimeWords } from '../../shared/activity-model.mjs'
import '../styles/activity.css'

const EVERY_MS = 2000
const percent = (part) => `${Math.round(part * 100)}%`

/* Power tools → Activity (Phase 93, desktop/activity.cjs): how this Mac is doing, without opening Activity Monitor.
   Memory (and how full it feels to macOS), the processor, the startup disk, the apps using the most memory with
   Quit, and the Mac's specs. Read every two seconds while it shows; only in the Mac app. */
export function ActivityView() {
  const bridge = window.osatActivity
  if (!bridge) return <p className="pop-gone">How your Mac is doing shows here in OSAT on your Mac.</p>
  return <ActivityRoom bridge={bridge} />
}

function ActivityRoom({ bridge }) {
  const [now, setNow] = useState(null)
  const [problem, setProblem] = useState('')
  // Apps asked to quit that are still running: their button becomes Force quit.
  const [asked, setAsked] = useState(() => new Set())
  const [by, setBy] = useState('memory')

  const read = useCallback(() => bridge.now().then((next) => { setNow(next); setProblem('') }, (error) => setProblem(cleanError(error))), [bridge])
  useEffect(() => {
    read()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') read() }, EVERY_MS)
    return () => clearInterval(timer)
  }, [read])

  async function quit(app) {
    const force = asked.has(app.path)
    try {
      await bridge.quit(app.path, force)
      setAsked((set) => new Set(set).add(app.path))
      read()
    } catch (error) { setProblem(cleanError(error)) }
  }

  if (!now) return <div className="activity"><p className="activity-quiet">{problem || 'Looking at your Mac…'}</p></div>
  if (!now.mac) return <p className="pop-gone">Activity reads a Mac’s memory and processor; this computer isn’t one.</p>
  const { memory, cpu, disk, specs, apps } = now
  const used = disk.total - disk.free
  const shown = [...apps].sort((a, b) => (by === 'cpu' ? b.cpu - a.cpu : b.bytes - a.bytes)).slice(0, 12)

  return (
    <div className="activity">
      <header className="activity-head">
        <h1>Activity</h1>
        <p>{[specs.chip, specs.macos && `macOS ${specs.macos}`, `on for ${uptimeWords(specs.uptime)}`].filter(Boolean).join(' · ')}</p>
      </header>
      {problem && <p className="activity-problem" role="status">{problem}</p>}

      <div className="activity-meters">
        <Meter label="Memory" value={memory.used / memory.total} big={bytesWords(memory.used)} of={`of ${bytesWords(memory.total)}`}
          note={PRESSURE_WORDS[memory.pressure]} state={memory.pressure} />
        <Meter label="Processor" value={cpu.busy} big={percent(cpu.busy)} of="busy" note={`${cpu.cores} cores`} state={cpu.busy > 0.85 ? 'warn' : 'normal'} />
        <Meter label="Disk" value={used / disk.total} big={bytesWords(disk.free)} of="free" note={`${bytesWords(used)} of ${bytesWords(disk.total)} used`}
          state={disk.free / disk.total < 0.1 ? 'warn' : 'normal'} />
      </div>

      <section className="activity-card" aria-label="Apps">
        <header className="activity-card-head">
          <h2>Using the most {by === 'cpu' ? 'processor' : 'memory'}</h2>
          <div className="activity-by" role="group" aria-label="Sort apps by">
            <button type="button" aria-pressed={by === 'memory'} onClick={() => setBy('memory')}>Memory</button>
            <button type="button" aria-pressed={by === 'cpu'} onClick={() => setBy('cpu')}>CPU</button>
          </div>
        </header>
        <ul className="activity-apps">
          {shown.map((app) => (
            <li key={app.path}>
              <span className="activity-app-name">{app.name}{app.count > 1 && <small>{app.count} processes</small>}</span>
              <span className="activity-num">{bytesWords(app.bytes)}</span>
              <span className="activity-num">{Math.round(app.cpu)}% CPU</span>
              <button type="button" className="text-button" onClick={() => quit(app)}>{asked.has(app.path) ? 'Force quit' : 'Quit'}</button>
            </li>
          ))}
        </ul>
        {!apps.length && <p className="activity-quiet">No apps of yours are running.</p>}
      </section>

      <section className="activity-card" aria-label="This Mac">
        <h2>This Mac</h2>
        <dl className="activity-specs">
          <dt>Model</dt><dd>{[specs.name, specs.model && `(${specs.model})`].filter(Boolean).join(' ') || 'A Mac'}</dd>
          <dt>Chip</dt><dd>{specs.chip || '—'}, {specs.cores} cores</dd>
          <dt>Memory</dt><dd>{bytesWords(memory.total)}</dd>
          <dt>Startup disk</dt><dd>{bytesWords(disk.total)}</dd>
          <dt>macOS</dt><dd>{specs.macos || '—'}</dd>
          <dt>In memory now</dt><dd>{bytesWords(memory.app)} apps · {bytesWords(memory.wired)} the Mac itself · {bytesWords(memory.compressed)} compressed · {bytesWords(memory.cached)} cached files</dd>
        </dl>
      </section>
    </div>
  )
}

function Meter({ label, value, big, of, note, state }) {
  return (
    <section className="activity-meter" data-state={state} aria-label={label}>
      <h2>{label}</h2>
      <p><strong>{big}</strong> {of}</p>
      <meter min={0} max={1} value={value} aria-label={`${label}: ${percent(value)}`} />
      <small>{note}</small>
    </section>
  )
}
