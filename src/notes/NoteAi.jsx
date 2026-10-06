import { useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { Markdown } from '../lib/markdown.jsx'
import { askLocalModel } from '../local-ai.js'
import { extractActions } from '../assistant/actions.js'
import { cleanError, useAi } from '../assistant/useAi.js'
import { isActiveNote } from '../notes-model.js'
import { NOTE_AI_TASKS, noteAiRequest } from './note-ai.js'

export function NoteAi({ workspace, note, actions, onClose }) {
  const { models, refresh } = useAi()
  const [selected, setSelected] = useState([])
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState(null)
  const abort = useRef(null)
  const first = useRef(null)
  useEffect(() => { first.current?.focus(); return () => abort.current?.abort() }, [])
  const extras = workspace.notes.filter((item) => selected.includes(item.id) && item.id !== note.id && isActiveNote(item))
  const request = note.markdown.trim() ? noteAiRequest(note, 'summary', extras) : null
  const local = models?.find((model) => model.offline === true && !model.id.startsWith('cloud:'))
  const available = workspace.notes.filter((item) => item.id !== note.id && isActiveNote(item) && `${item.title}\n${item.markdown}`.toLowerCase().includes(query.toLowerCase()))
  const busy = answer?.busy

  async function ask(task) {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const update = (patch) => {
      if (abort.current === controller && !controller.signal.aborted) setAnswer((value) => ({ ...value, ...patch }))
    }
    const snapshot = noteAiRequest(note, task, extras)
    setAnswer({ id: `note-${crypto.randomUUID()}`, task, text: '', busy: true, error: '', saved: false, original: note.markdown, titles: [note.title, ...extras.map((item) => item.title)], truncated: snapshot.truncated })
    try {
      const text = await askLocalModel(snapshot.messages, {
        signal: controller.signal,
        unavailableMessage: 'Local AI is unavailable. In the Mac app, set up a model in Settings → AI. For this browser preview, start a loaded model’s LM Studio local server.',
        onDelta: (delta) => {
          if (abort.current === controller && !controller.signal.aborted) setAnswer((value) => ({ ...value, text: value.text + delta }))
        },
      })
      const body = extractActions(text).body
      if (!body.trim()) throw new Error('The local model returned no answer. Try again.')
      update({ text: body, busy: false })
    } catch (error) {
      update({ busy: false, error: cleanError(error) })
    }
  }

  function stop() {
    abort.current?.abort()
    abort.current = null
    setAnswer((value) => value ? { ...value, busy: false, error: 'Stopped. The partial response has not been saved.' } : value)
  }

  function save() {
    if (!answer?.text.trim() || answer.busy || answer.error || answer.saved) return
    if (actions.saveAiResponse(note.id, answer)) setAnswer((value) => ({ ...value, saved: true }))
    else setAnswer((value) => ({ ...value, error: 'This note is no longer available. Your response is still here to copy.' }))
  }

  return (
    <section className="note-ai" aria-label="Local AI for this note" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <header><strong>Think with local AI</strong><button className="icon-button" type="button" aria-label="Close note AI" onClick={onClose}><X /></button></header>
      <p>Each action shares this note with AI on this Mac. Your writing stays as it is.</p>
      <div className="note-ai-actions">
        {Object.entries(NOTE_AI_TASKS).map(([task, { label }], index) => <button ref={index === 0 ? first : null} className="outline-button" type="button" key={task} disabled={busy || !request} onClick={() => ask(task)}>{label}</button>)}
        {busy && <button type="button" className="text-button" onClick={stop}>Stop</button>}
      </div>
      {!answer && !local && <p role="status">{models === null ? 'Checking local AI…' : <>No local model is available. <button type="button" className="text-button" onClick={refresh}>Check again</button></>}</p>}
      {!request && <p>Write something in this note first.</p>}
      <details>
        <summary>Other notes · {extras.length ? `${extras.length} selected` : 'none shared'}</summary>
        <input aria-label="Find notes to share with note AI" placeholder="Find a note to share" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
        <div className="note-ai-sources">
          {available.slice(0, 30).map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} disabled={busy || (!selected.includes(item.id) && extras.length >= 7)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />{item.title || 'Untitled note'}</label>)}
          {available.length > 30 && <small>Search to see more notes.</small>}
        </div>
        {extras.length > 0 && <p>Selected: {extras.map((item) => item.title || 'Untitled note').join(' · ')}</p>}
      </details>
      {request?.truncated && !answer && <p>Only the first 8,000 characters of this note and up to 4,000 of selected context are shared (1,600 per extra note).</p>}
      {answer && <div className="note-ai-answer">
        <small>{NOTE_AI_TASKS[answer.task].label} · Shared: {answer.titles.join(' · ')}{answer.truncated ? ' · Only the start of long notes was shared' : ''}</small>
        <p role="status">{busy ? 'Thinking locally…' : answer.saved ? 'Added as a separate linked note. Your original writing is preserved.' : 'Review before saving.'}</p>
        {answer.error && <p role="alert">{answer.error}</p>}
        {answer.text && <Markdown text={extractActions(answer.text).body} />}
        {!busy && answer.text && !answer.saved && <details><summary>Edit response</summary><textarea aria-label="AI response to save" value={answer.text} onChange={(event) => setAnswer((value) => ({ ...value, text: event.target.value }))} /></details>}
        {!busy && !answer.saved && answer.original !== note.markdown && <p>You’ve edited this note since asking. Those edits will be kept.</p>}
        {!busy && (answer.saved
          ? <button type="button" className="outline-button" onClick={() => actions.selectNote(answer.id)}>Open saved note</button>
          : <button type="button" className="outline-button" disabled={Boolean(answer.error) || !answer.text.trim()} onClick={save}>Save as linked note</button>)}
      </div>}
    </section>
  )
}
