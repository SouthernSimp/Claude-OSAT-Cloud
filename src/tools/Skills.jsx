import { useCallback, useEffect, useState } from 'react'
import { ListChecks, Play, Record, Stop, Trash } from '@phosphor-icons/react'

import { stepWords } from '../../shared/skill-model.mjs'

/* Skills in the Browser room (Phase 19, "Record a skill"): do something once, OSAT writes each step in plain words and
   saves it under a name, and one button does it again. `useSkills` talks to the Mac app (`osatSkills`); `SkillBar` is the
   strip under the address bar (recording, running, and how it went); `SkillList` is on the start page. Asking nothing
   scary: a skill only runs when its Run is pressed, and a password is typed by the person. */

const plain = (error) => String(error?.message || 'That did not work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function useSkills(onMessage) {
  const bridge = typeof window === 'undefined' ? null : window.osatSkills
  const [skills, setSkills] = useState([])
  const [state, setState] = useState({ recording: null, running: null, result: null })
  const reload = useCallback(() => bridge?.list().then(setSkills, () => {}), [bridge])
  useEffect(() => {
    if (!bridge) return undefined
    reload()
    bridge.state().then(setState, () => {})
    return bridge.onState(setState)
  }, [bridge, reload])

  /* Runs one thing and says so calmly when it can't. */
  const attempt = async (action) => {
    try { return await action() } catch (error) { onMessage?.(plain(error)); return null }
  }
  return {
    available: Boolean(bridge),
    skills,
    state,
    record: () => attempt(() => bridge.recordStart()),
    save: (name) => attempt(async () => { const skill = await bridge.recordStop(name); await reload(); return skill }),
    cancel: () => attempt(() => bridge.recordCancel()),
    run: (id, from = 0) => attempt(() => bridge.run(id, from)),
    stop: () => attempt(() => bridge.stop()),
    clear: () => attempt(() => bridge.clear()),
    remove: (id) => attempt(async () => { const gone = await bridge.remove(id); await reload(); return gone }),
    restore: (skill) => attempt(async () => { await bridge.put(skill); await reload() }),
  }
}

export function SkillBar({ skills }) {
  const { state } = skills
  const [name, setName] = useState('')
  const { recording, running, result } = state
  if (recording) {
    const last = recording.steps.slice(-3)
    return (
      <div className="skill-bar is-recording" role="status">
        <p><Record weight="fill" /> <strong>Recording</strong> · {recording.count === 1 ? '1 step' : `${recording.count} steps`}. Do it once on the page; passwords are never kept.</p>
        <ol>{last.map((words, index) => <li key={`${recording.steps.length}-${index}`}>{words}</li>)}</ol>
        <form onSubmit={async (event) => { event.preventDefault(); if (name.trim() && await skills.save(name)) setName('') }}>
          <input
            value={name}
            aria-label="Name this skill"
            placeholder="Name this skill, like “Pay rent”"
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); if (name) setName(''); else skills.cancel() } }}
          />
          <button type="submit" className="skill-primary" disabled={!name.trim() || recording.count < 1}>Save skill</button>
          <button type="button" onClick={() => { setName(''); skills.cancel() }}>Cancel</button>
        </form>
      </div>
    )
  }
  if (running) {
    return (
      <div className="skill-bar" role="status">
        <p><Play weight="fill" /> Running <strong>{running.name}</strong> · step {running.step + 1} of {running.total}: {running.words}</p>
        <button type="button" onClick={skills.stop}><Stop weight="fill" /> Stop</button>
      </div>
    )
  }
  if (result) {
    return (
      <div className={`skill-bar ${result.ok ? '' : 'is-stuck'}`} role="status">
        <p>{result.paused ? result.message : result.ok ? <>Done: <strong>{result.name}</strong>.</> : <><strong>{result.name}</strong>. {result.message}</>}</p>
        {result.paused && <button type="button" className="skill-primary" onClick={() => { const skill = skills.skills.find((item) => item.name === result.name); if (skill) skills.run(skill.id, result.at) }}>Continue</button>}
        {!result.ok && <button type="button" onClick={() => { const skill = skills.skills.find((item) => item.name === result.name); if (skill) skills.run(skill.id) }}>Try again</button>}
        <button type="button" onClick={skills.clear}>{result.paused ? 'Never mind' : 'Dismiss'}</button>
      </div>
    )
  }
  return null
}

export function SkillList({ skills, onRemoved }) {
  const [open, setOpen] = useState(null)
  if (!skills.available) return null
  const busy = Boolean(skills.state.running || skills.state.recording)
  return (
    <div className="skill-list">
      <h3><ListChecks /> Your skills</h3>
      {skills.skills.length === 0
        ? <p className="skill-empty">Open a page, press <strong>Record a skill</strong>, do something once, and name it. It will be here to run again.</p>
        : skills.skills.map((skill) => (
          <div key={skill.id} className="skill-row">
            <div className="skill-row-main">
              <strong>{skill.name}</strong>
              <button type="button" className="skill-steps" aria-expanded={open === skill.id} onClick={() => setOpen(open === skill.id ? null : skill.id)}>
                {skill.steps.length - 1 === 1 ? '1 step' : `${skill.steps.length - 1} steps`} · {open === skill.id ? 'Hide' : 'See them'}
              </button>
              <button type="button" className="skill-primary" disabled={busy} onClick={() => skills.run(skill.id)}><Play weight="fill" /> Run</button>
              <button type="button" className="skill-trash" aria-label={`Delete ${skill.name}`} disabled={busy} onClick={async () => { const gone = await skills.remove(skill.id); if (gone) onRemoved?.(gone) }}><Trash /></button>
            </div>
            {open === skill.id && <ol>{skill.steps.map((step, index) => <li key={index}>{stepWords(step)}</li>)}</ol>}
          </div>
        ))}
      <p className="skill-note">Skills stay on this Mac. What you type in one is saved with it; passwords never are.</p>
    </div>
  )
}
