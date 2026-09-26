import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp, CaretLeft, Check, CheckCircle, CloudCheck, CloudSlash, House, MagnifyingGlass, NotePencil, PushPin, Trash,
} from '@phosphor-icons/react'

import { localDateKey } from '../daily-practice.js'
import { dayPhase, phaseCopy } from '../field/field-model.js'
import { formatRelativeTime } from '../lib/ui.js'
import { addNextStep, bringForward, earlierSteps, nextSteps, toggleNextStep } from '../next-steps.js'
import {
  captureThought, dayNoteId, excerpt, isActiveNote, keepNotes, relinkRenamedNote, restoreNotes, searchNotes, sortNotes, trashNotes, updateNote,
} from '../notes-model.js'
import { phoneSync } from '../store/bridges.js'
import { useWorkspace } from '../store/useWorkspace.js'
import '../styles/phone.css'

/* OSAT on the iPhone: drop a thought, see what's next, read and write your notes.
   The same workspace as the Mac, kept in step through iCloud (store/bridges.js). */

const DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const TABS = [
  { id: 'today', label: 'Today', icon: House },
  { id: 'notes', label: 'Notes', icon: NotePencil },
  { id: 'sync', label: 'iCloud', icon: CloudCheck },
]

export function PhoneSurface() {
  const { workspace, commit, ready } = useWorkspace()
  const [tab, setTab] = useState('today')
  const [openId, setOpenId] = useState(null)
  const [undo, setUndo] = useState(null)

  useEffect(() => {
    if (!undo) return undefined
    const timer = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(timer)
  }, [undo])

  if (!ready || !workspace) return <main className="phone" />
  const notes = workspace.notes.filter(isActiveNote)
  const note = openId ? workspace.notes.find((item) => item.id === openId && !item.trashedAt) : null
  const trash = (id) => {
    commit((state) => trashNotes(state, [id]))
    setOpenId(null)
    setUndo({ ids: [id] })
  }

  return (
    <main className="phone" data-tab={tab}>
      <div className="phone-wall" aria-hidden="true" style={{ backgroundImage: 'url(./images/wall-lake.jpg)' }} />
      <div className="phone-scroll" inert={note ? true : undefined}>
        {tab === 'today' && <Today notes={notes} commit={commit} open={setOpenId} />}
        {tab === 'notes' && <Notes notes={notes} open={setOpenId} />}
        {tab === 'sync' && <Sync workspace={workspace} commit={commit} />}
      </div>
      {note && <Editor key={note.id} note={note} commit={commit} close={() => setOpenId(null)} trash={trash} />}
      {undo && (
        <div className="phone-toast glass" role="status">
          Moved to the Trash
          <button type="button" onClick={() => { commit((state) => restoreNotes(state, undo.ids)); setUndo(null) }}>Undo</button>
        </div>
      )}
      <nav className="phone-tabs glass" aria-label="OSAT" inert={note ? true : undefined}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setOpenId(null) }}>
            <Icon weight={tab === id ? 'fill' : 'regular'} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}

/* A captured thought's text starts with its title; the preview shows what comes after. */
const preview = (note) => excerpt(note.markdown.startsWith(note.title) ? note.markdown.slice(note.title.length) : note.markdown, 90)

function Row({ note, open }) {
  const text = preview(note)
  return (
    <li>
      <button type="button" className="phone-row" onClick={() => open(note.id)}>
        <strong>{note.pinned && <PushPin weight="fill" />}{note.title || 'Untitled'}</strong>
        {text && <span>{text}</span>}
        <small>{formatRelativeTime(note.updatedAt)}</small>
      </button>
    </li>
  )
}

function Today({ notes, commit, open }) {
  const [mode, setMode] = useState('note')
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('')
  const now = new Date()
  const today = localDateKey(now)
  const [greeting] = phaseCopy(dayPhase(now))
  const earlier = earlierSteps(notes, today)
  const earlierIds = new Set(earlier.map((step) => step.id))
  const planId = dayNoteId(today)
  const steps = nextSteps(notes)
    .filter((step) => !step.done && !earlierIds.has(step.id))
    .sort((a, b) => (b.noteId === planId) - (a.noteId === planId))
  const unsorted = sortNotes(notes.filter((note) => note.unsorted))
  const recent = sortNotes(notes.filter((note) => !note.unsorted && note.kind !== 'day')).slice(0, 4)

  useEffect(() => {
    if (!saved) return undefined
    const timer = setTimeout(() => setSaved(''), 1800)
    return () => clearTimeout(timer)
  }, [saved])

  function submit(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    if (mode === 'step') {
      commit((state) => addNextStep(state, text.replace(/\s*\n\s*/g, ' ').slice(0, 240), today))
      setSaved('Added to today')
    } else {
      commit((state) => captureThought(state, text, 'iPhone').state)
      setSaved('Saved in Unsorted')
    }
    setDraft('')
  }

  return (
    <>
      <header className="phone-head">
        <p>{DATE.format(now)}</p>
        <h1>{greeting}</h1>
      </header>

      <form className="phone-capture glass" onSubmit={submit}>
        <div className="phone-seg" role="radiogroup" aria-label="What to add">
          {[['note', 'Thought', NotePencil], ['step', 'Next step', CheckCircle]].map(([id, label, Icon]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}><Icon /> {label}</button>
          ))}
        </div>
        <label className="visually-hidden" htmlFor="phone-line">{mode === 'step' ? 'A next step' : 'A thought'}</label>
        <textarea
          id="phone-line"
          rows={mode === 'step' ? 1 : 3}
          value={draft}
          maxLength={mode === 'step' ? 240 : 8000}
          placeholder={mode === 'step' ? 'One small next step…' : 'Leave a thought here.'}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="phone-capture-foot">
          <span role="status">{saved ? <><Check /> {saved}</> : mode === 'step' ? 'Goes on today’s page' : 'Waits in Unsorted until you sort it'}</span>
          <button type="submit" aria-label={mode === 'step' ? 'Add the step' : 'Save the thought'} disabled={!draft.trim()}><ArrowUp weight="bold" /></button>
        </div>
      </form>

      <section className="phone-card glass" aria-labelledby="phone-next">
        <h2 id="phone-next">Next</h2>
        {steps.length ? (
          <ul className="phone-steps">
            {steps.slice(0, 5).map((step) => (
              <li key={step.id}>
                <button type="button" className="ring" aria-label={`Complete ${step.text}`} onClick={() => commit((state) => ({ ...state, notes: toggleNextStep(state.notes, step) }))} />
                <button type="button" className="step-text" onClick={() => open(step.noteId)}>{step.text}</button>
              </li>
            ))}
          </ul>
        ) : <p className="phone-quiet">Nothing waiting.</p>}
        {earlier.length > 0 && (
          <button type="button" className="phone-link" onClick={() => commit((state) => bringForward(state, today))}>
            Bring {earlier.length} from earlier days
          </button>
        )}
      </section>

      {unsorted.length > 0 && (
        <section className="phone-card glass" aria-labelledby="phone-unsorted">
          <h2 id="phone-unsorted">Unsorted</h2>
          <ul className="phone-list">{unsorted.slice(0, 6).map((note) => <Row key={note.id} note={note} open={open} />)}</ul>
        </section>
      )}

      {recent.length > 0 && (
        <section className="phone-card glass" aria-labelledby="phone-recent">
          <h2 id="phone-recent">Recent</h2>
          <ul className="phone-list">{recent.map((note) => <Row key={note.id} note={note} open={open} />)}</ul>
        </section>
      )}
    </>
  )
}

function Notes({ notes, open }) {
  const [query, setQuery] = useState('')
  const [list, setList] = useState('all')
  const scoped = list === 'unsorted' ? notes.filter((note) => note.unsorted) : list === 'pinned' ? notes.filter((note) => note.pinned) : notes
  const shown = sortNotes(searchNotes(scoped, query))
  return (
    <>
      <header className="phone-head"><h1>Notes</h1></header>
      <label className="phone-search glass">
        <MagnifyingGlass />
        <input type="search" value={query} placeholder="Search your notes" aria-label="Search your notes" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="phone-seg phone-seg-wide" role="radiogroup" aria-label="Which notes">
        {[['all', 'All'], ['unsorted', 'Unsorted'], ['pinned', 'Pinned']].map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={list === id} onClick={() => setList(id)}>{label}</button>
        ))}
      </div>
      {shown.length ? (
        <ul className="phone-list phone-card glass">{shown.map((note) => <Row key={note.id} note={note} open={open} />)}</ul>
      ) : (
        <p className="phone-quiet phone-empty">{query ? 'No note matches that.' : list === 'unsorted' ? 'Nothing waiting to be sorted.' : list === 'pinned' ? 'Pin a note to keep it here.' : 'Your notes will appear here.'}</p>
      )}
    </>
  )
}

/* One note, full screen. Every keystroke is saved; the title's links follow a rename when you leave it. */
function Editor({ note, commit, close, trash }) {
  const titleAtFocus = useRef(note.title)
  const body = useRef(null)
  return (
    <section className="phone-editor" role="dialog" aria-label={note.title || 'Note'}>
      <header className="phone-editor-bar">
        <button type="button" className="phone-back" onClick={close}><CaretLeft weight="bold" /> Back</button>
        <span />
        {note.unsorted && <button type="button" className="phone-keep" onClick={() => commit((state) => keepNotes(state, [note.id]))}>Keep</button>}
        <button type="button" aria-label={note.pinned ? 'Unpin' : 'Pin to top'} aria-pressed={note.pinned} onClick={() => commit((state) => updateNote(state, note.id, { pinned: !note.pinned }))}>
          <PushPin weight={note.pinned ? 'fill' : 'regular'} />
        </button>
        <button type="button" aria-label="Move to Trash" onClick={() => trash(note.id)}><Trash /></button>
      </header>
      <input
        className="phone-editor-title"
        value={note.title}
        placeholder="Title"
        aria-label="Title"
        onFocus={() => { titleAtFocus.current = note.title }}
        onChange={(event) => commit((state) => updateNote(state, note.id, { title: event.target.value }))}
        onBlur={() => {
          const before = titleAtFocus.current
          if (before && before !== note.title) commit((state) => relinkRenamedNote(state, before, note.title))
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); body.current?.focus() } }}
      />
      <textarea
        ref={body}
        className="phone-editor-body"
        value={note.markdown}
        placeholder="Write here."
        aria-label="Note"
        onChange={(event) => commit((state) => updateNote(state, note.id, { markdown: event.target.value }))}
      />
      <p className="phone-editor-foot">{note.unsorted ? 'In Unsorted · ' : ''}Edited {formatRelativeTime(note.updatedAt)}</p>
    </section>
  )
}

function useSyncStatus() {
  const [status, setStatus] = useState(phoneSync.status)
  useEffect(() => phoneSync.subscribe(setStatus), [])
  return status
}

function Sync({ workspace, commit }) {
  const status = useSyncStatus()
  const on = status.mode === 'icloud'
  return (
    <>
      <header className="phone-head"><h1>iCloud</h1></header>
      <section className="phone-card glass phone-sync">
        <span className={`phone-sync-icon ${on ? 'is-on' : ''}`}>{on ? <CloudCheck weight="fill" /> : <CloudSlash />}</span>
        <h2>{on ? (status.devices ? 'In step with your Mac.' : 'Waiting for your Mac.') : status.mode === 'local' ? 'iCloud is off.' : 'A preview of OSAT for iPhone.'}</h2>
        <p>
          {status.error
            || (on
              ? status.devices
                ? `Changes go both ways through your iCloud Drive${status.lastArrival ? `; the last one arrived ${formatRelativeTime(status.lastArrival)}` : ''}.`
                : 'On your Mac, open OSAT → Settings → iPhone and turn it on. Your notes will arrive here.'
              : status.mode === 'local'
                ? 'Your notes stay on this iPhone. Turn on iCloud Drive in Settings to keep them in step with your Mac.'
                : 'In the app, your notes stay in step with OSAT on your Mac.')}
        </p>
        {on && <button type="button" className="phone-link" onClick={() => phoneSync.pull()}>Check now</button>}
      </section>
      <section className="phone-card glass">
        <h2>Appearance</h2>
        <div className="phone-seg phone-seg-wide" role="radiogroup" aria-label="Light or dark">
          {[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={workspace.theme === id} onClick={() => commit((state) => ({ ...state, theme: id }))}>{label}</button>
          ))}
        </div>
      </section>
      <p className="phone-quiet phone-private">Your notes live on your devices and in your own iCloud. No account, no other cloud.</p>
    </>
  )
}
