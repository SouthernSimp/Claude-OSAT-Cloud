import { useCallback, useEffect, useState } from 'react'
import { CircleNotch, DownloadSimple, Microphone, Stop, Warning } from '@phosphor-icons/react'

import { cleanError } from '../assistant/useAi.js'
import { clock, durationWords } from '../../shared/meeting-model.mjs'
import { Switch } from './settings/parts.jsx'
import '../styles/meetings.css'

const SYSTEM_KEY = 'osat.meetings.system.v1'
const readSystem = () => { try { return localStorage.getItem(SYSTEM_KEY) !== 'no' } catch { return true } }
const keepSystem = (on) => { try { localStorage.setItem(SYSTEM_KEY, on ? 'yes' : 'no') } catch { /* the next open starts on */ } }
const when = (ms) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(ms)
const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`

/* Meetings (Phase 57, desktop/meetings/): OSAT listens to a meeting on this Mac and, when you stop, writes it up: a
   summary, what was decided, a to-do list, and the words themselves, as two notes, and each thing promised as a
   to-do (Phase 74). They arrive in Just in. Only in the Mac app; the sound is deleted once it is written up. Below,
   to-dos from Granola's meetings (desktop/meetings/granola.cjs). */
export function MeetingsView(room) {
  const bridge = window.osatMeetings
  if (!bridge) return <p className="pop-gone">Meetings listen through OSAT on your Mac.</p>
  return <MeetingsRoom bridge={bridge} navigate={room.navigate} />
}

function MeetingsRoom({ bridge, navigate }) {
  const [status, setStatus] = useState(null)
  const [problem, setProblem] = useState('')
  const [system, setSystem] = useState(readSystem)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    bridge.status().then(setStatus, (error) => setProblem(cleanError(error)))
    return bridge.onChange(setStatus)
  }, [bridge])
  const recording = status?.state === 'recording'
  useEffect(() => {
    if (!recording) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [recording])

  const run = useCallback(async (action) => {
    setBusy(true)
    setProblem('')
    try { setStatus(await action()) } catch (error) { setProblem(cleanError(error)) } finally { setBusy(false) }
  }, [])

  if (!status) return <p className="pop-gone">{problem || 'Looking for the microphone…'}</p>
  const { ears } = status
  const download = ears.download

  return (
    <div className="mt-room">
      {problem && <p className="mt-said is-problem" role="alert"><Warning /> {problem}</p>}
      {status.problem && <p className="mt-said is-problem" role="alert"><Warning /> {status.problem}</p>}

      {!ears.ready && (
        <section className="mt-main">
          <Microphone aria-hidden="true" className="mt-icon" />
          <h2>Listen to a meeting</h2>
          <p>OSAT can listen to a meeting on this Mac and write it up: a summary, what was decided, and a to-do list. The listening happens here; nothing is uploaded, and the sound is deleted once it is written up.</p>
          {download?.state === 'running' ? (
            <div className="mt-progress">
              <progress value={download.received} max={download.total} aria-label="Downloading the listening model" />
              <span>{megabytes(download.received)} of {megabytes(download.total)}</span>
              <button type="button" className="outline-button" onClick={() => run(bridge.cancelEars)}>Stop</button>
            </div>
          ) : (
            <>
              <button type="button" className="primary-button" disabled={busy} onClick={() => run(bridge.getEars)}><DownloadSimple /> Get the listening model ({megabytes(ears.size)})</button>
              <p className="mt-quiet">{download?.message || 'It is a one-time download. After that, meetings work without the internet.'}</p>
            </>
          )}
        </section>
      )}

      {ears.ready && status.state === 'idle' && (
        <section className="mt-main">
          <Microphone aria-hidden="true" className="mt-icon" />
          <h2>Listen to a meeting</h2>
          <p>Start before the meeting, then stop when it is over. You can put OSAT away while it listens.</p>
          <button type="button" className="primary-button mt-start" disabled={busy} onClick={() => run(() => bridge.start({ system }))}><Microphone weight="fill" /> Start listening</button>
          <label className="mt-check">
            <input type="checkbox" checked={system} onChange={(event) => { setSystem(event.target.checked); keepSystem(event.target.checked) }} />
            Also hear the other people (what your Mac plays)
          </label>
          <p className="mt-quiet">
            Tell the others you are recording; some places require it.
            {!status.ai && ' No AI is set up yet, so you will get the words only. Choose a size in Settings → AI for a summary.'}
          </p>
        </section>
      )}

      {status.state === 'recording' && (
        <section className="mt-main" aria-live="polite">
          <span className="mt-dot" aria-hidden="true" />
          <h2>Listening… {clock(Math.max(0, now - status.startedAt))}</h2>
          <p>{status.system ? 'Hearing you and the other people.' : 'Hearing you.'} You can put OSAT away; it keeps listening.</p>
          {status.note && <p className="mt-said"><Warning /> {status.note}</p>}
          <button type="button" className="primary-button mt-start" disabled={busy} onClick={() => run(bridge.stop)}><Stop weight="fill" /> Stop and write it up</button>
        </section>
      )}

      {status.state === 'working' && (
        <section className="mt-main" aria-live="polite">
          <CircleNotch className="mt-icon is-spinning" aria-hidden="true" />
          <h2>{status.stage === 'writing' ? 'Writing it up…' : `Listening back… ${status.percent}%`}</h2>
          <p>This takes a few minutes for a long meeting. You can keep working; OSAT will tell you when it is done.</p>
        </section>
      )}

      {status.state === 'idle' && status.unfinished.map((item) => (
        <section key={item.id} className="mt-card">
          <div>
            <strong>A meeting that was not written up</strong>
            <small>{when(item.startedAt)} · {durationWords(item.seconds * 1000)} heard. The sound is still on this Mac.</small>
          </div>
          <button type="button" className="primary-button" disabled={busy || !ears.ready} onClick={() => run(() => bridge.finish(item.id))}>Write it up</button>
          <button type="button" className="outline-button" disabled={busy} onClick={() => run(() => bridge.discard(item.id))}>Delete it</button>
        </section>
      ))}

      {status.state === 'idle' && status.last && (
        <section className="mt-card">
          <div>
            <strong>{status.last.title}</strong>
            <small>{status.last.full ? 'Written up. It is in Just in, with the words beside it, and each thing promised is a to-do.' : 'The words are saved in Just in. They are not summarised: no AI was set up.'}</small>
          </div>
          <button type="button" className="primary-button" onClick={() => navigate('Notes', { noteId: status.last.writeUpId })}>Open</button>
          <button type="button" className="outline-button" disabled={busy} onClick={() => run(bridge.undo)}>Undo</button>
        </section>
      )}

      {bridge.granola && <GranolaCard bridge={bridge} navigate={navigate} />}
    </div>
  )
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/* To-dos from Granola (Phase 74): once Granola is connected, what its notes list under Next steps comes into Just in as
   to-dos, once an hour. One switch, what the last look brought, Look now, and Take them back for that batch. */
function GranolaCard({ bridge, navigate }) {
  const [state, setState] = useState(null)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    bridge.granola().then(setState, () => {})
    return bridge.onGranola(setState)
  }, [bridge])
  if (!state) return null
  const act = (work) => { setProblem(''); work().then(setState, (error) => setProblem(cleanError(error))) }
  const line = !state.on
    ? 'Off. Turn it on and the next steps from your Granola meetings come into Just in as to-dos.'
    : state.connected === false ? 'Connect Granola in Settings → Connections, and its next steps come into Just in as to-dos.'
      : state.busy ? 'Looking at your Granola meetings…'
        : problem || state.problem || (state.last?.count
          ? `${plural(state.last.count, 'to-do')} from ${plural(state.last.meetings, 'meeting')}, ${when(state.last.at)}. Each hour, new meetings’ next steps come in.`
          : 'Each hour, the next steps from your new Granola meetings come into Just in as to-dos.')
  return (
    <section className="mt-card" aria-label="To-dos from Granola">
      <div>
        <strong>To-dos from Granola</strong>
        <small>{line}</small>
      </div>
      {state.on && state.connected === false && <button type="button" className="outline-button" onClick={() => navigate('Settings', { section: 'bots' })}>Connections</button>}
      {state.on && state.connected !== false && <button type="button" className="outline-button" disabled={state.busy} onClick={() => act(bridge.granolaNow)}>Look now</button>}
      {state.on && state.last?.undo && <button type="button" className="outline-button" disabled={state.busy} onClick={() => act(bridge.undoGranola)}>Take them back</button>}
      <Switch label="To-dos from Granola" checked={state.on} onChange={(on) => act(() => bridge.setGranola(on))} />
    </section>
  )
}
