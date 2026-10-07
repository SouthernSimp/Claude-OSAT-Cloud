import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, MagnifyingGlass, Plus, Sparkle, Stack, X } from '@phosphor-icons/react'

import { actionLabel, localModel } from '../assistant/ai-state.js'
import { useAiJob } from '../assistant/useAiJob.js'
import { inputActive, formatRelativeTime } from '../lib/ui.js'
import { folderPath } from '../notes-model.js'
import { writeSticky } from './Sticky.jsx'
import { findPlaces, homeOptions, placementMessages, placementPlaces, readPlacement, sortQueue } from './sort-review.js'
import { MOST, modelSuggestions, sortRequests, stillToSort, wordSuggestions } from './sort-unsorted.js'

const sayStickies = (count) => `${count} ${count === 1 ? 'sticky' : 'stickies'}`
const pathOf = (folders, id) => folderPath(folders, id).join(' › ')

/* Sort Unsorted: one sticky at a time, under one question, "Where does this sticky go?". The sticky
   on the left; on the right the places it could go, best first, each with why and what is in it; the
   one picked moves with Return (the one blue button). Skip for now, Put it on the Sky and Delete are
   quiet, one key away; every placement offers Undo; "Sticky 2 of 5" counts the sitting. "Suggest homes
   for all" asks the AI (or matching words) about the whole pile and shows one sentence per place
   ("Move 3 stickies to Garden"), saying how many have no clear home. Nothing moves until you say so. */
export function UnsortedSorter({ workspace, notes, actions, history, ai, navigate, start, hidden, onBrowse, onClose }) {
  const [order, setOrder] = useState([])
  const [chosen, setChosen] = useState(false)
  const [currentId, setCurrentId] = useState(null)
  const [pick, setPick] = useState(null)
  const [query, setQuery] = useState('')
  const [names, setNames] = useState({})
  const [picks, setPicks] = useState({})
  const [view, setView] = useState('one')
  const [review, setReview] = useState(null)
  const [placed, setPlaced] = useState(0)
  const [say, setSay] = useState('')
  const root = useRef(null)
  const findField = useRef(null)
  const nameField = useRef(null)
  const latest = useRef(workspace)
  latest.current = workspace

  const model = localModel(ai?.models)
  const aiArgs = { status: ai?.status, models: ai?.models, offline: ai?.offline, model }
  const one = useAiJob(aiArgs)
  const bulk = useAiJob(aiArgs)

  const queue = useMemo(() => sortQueue(order, notes, { chosen }), [order, notes, chosen])
  const byId = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const current = byId.get(queue.includes(currentId) ? currentId : queue[0]) || null
  const index = current ? queue.indexOf(current.id) : -1
  const pile = useMemo(() => queue.map((id) => byId.get(id)), [queue, byId])
  const recent = useMemo(() => [...new Set(history.slice().reverse().map((entry) => entry.folderId).filter(Boolean))].slice(0, 3), [history])
  const aiPick = current ? picks[current.id] : null
  const { homes, newNode } = useMemo(
    () => homeOptions(workspace, current, { pile, recent, picks: aiPick?.list || [] }),
    [workspace, current, pile, recent, aiPick],
  )
  const found = useMemo(() => (query.trim() ? findPlaces(workspace, query) : []), [workspace, query])
  const newName = current ? names[current.id] ?? newNode?.name ?? '' : ''
  const rows = query.trim()
    ? found.map((place) => ({ kind: 'move', key: `find:${place.folderId}`, folderId: place.folderId, path: place.path, why: '', count: null, peek: [] }))
    : [...homes.map((home) => ({ kind: 'move', ...home })), { kind: 'make', key: 'make', name: newName, why: newNode?.why || '' }]
  // What Return does: the row picked, else the first home, else leaving it on the Sky.
  const defaultPick = query.trim() ? (rows.length ? 0 : null) : homes.length ? 0 : newNode ? rows.length - 1 : null
  const selected = pick === null ? defaultPick : Math.min(pick, rows.length - 1)
  const row = selected === null || selected < 0 ? null : rows[selected]
  const ready = row && !(row.kind === 'make' && !row.name.trim())
  const numbered = rows.filter((item) => item.kind === 'move').length

  // A new request to sort (a sticky picked on the Sky, the list's chosen few, or "sort them all").
  useEffect(() => {
    if (!start) return
    if (start.ids) { setOrder(start.ids); setChosen(Boolean(start.chosen)) }
    if (start.ids || start.target) setCurrentId(start.target || start.ids?.[0] || null)
    if ((start.target || start.mode === 'all') && !start.ids) setChosen(false)
    setView(start.mode === 'all' ? 'all' : 'one')
  }, [start?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  // Sort Unsorted from the Sky's Ask card: the whole pile.
  useEffect(() => { if (start?.mode === 'all' && !start.ids) sortAll({ whole: true }) }, [start?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  // Moving to another sticky starts fresh: no half-typed search, no question still out.
  useEffect(() => { setPick(null); setQuery(''); one.stop() }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hidden) one.stop() }, [hidden]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hidden && !inputActive()) requestAnimationFrame(() => root.current?.focus({ preventScroll: true }))
  }, [hidden, current?.id, view])
  // Keys work even when nothing has focus (the button just clicked went away).
  const keys = useRef(null)
  useEffect(() => {
    if (hidden) return undefined
    const loose = (event) => { if (document.activeElement === document.body || !document.activeElement) keys.current?.(event) }
    window.addEventListener('keydown', loose)
    return () => window.removeEventListener('keydown', loose)
  }, [hidden])

  function goTo(id) { setCurrentId(id) }
  function advanceFrom(id) {
    const at = queue.indexOf(id)
    setCurrentId(queue[at + 1] ?? queue[at - 1] ?? null)
  }

  function place(kind, chosenRow = row) {
    if (!current) return
    const note = current
    let result
    if (kind === 'sky') result = actions.fileUnsorted([note.id], null, '', { sky: true })
    else if (kind === 'trash') result = actions.fileUnsorted([note.id], null, '', { trash: true })
    else if (!chosenRow) result = actions.fileUnsorted([note.id], null, '', { sky: true })
    else if (chosenRow.kind === 'make') { if (!chosenRow.name.trim()) return; result = actions.fileUnsorted([note.id], null, chosenRow.name) }
    else result = actions.fileUnsorted([note.id], chosenRow.folderId)
    if (!result) { setSay('This sticky or its place changed. Nothing moved.'); return }
    const title = `“${(note.title || 'Untitled').slice(0, 40)}”`
    const where = result.folderId ? pathOf(result.state.folders, result.folderId) : ''
    const message = kind === 'trash' ? `Deleted ${title}` : where ? `Moved ${title} to ${where}` : `Put ${title} on the canvas`
    advanceFrom(note.id)
    setPlaced((value) => value + 1)
    setSay(message)
    actions.showUndo(message, undo)
  }

  function later() {
    if (!current) return
    if (queue.length < 2) { setSay('This is the only one left.'); return }
    const id = current.id
    setOrder([...queue.filter((item) => item !== id), id])
    setCurrentId(queue[index + 1] ?? queue[0])
    setSay('Skipped for now: it waits at the end.')
  }

  function undo() {
    const ids = actions.undoUnsorted() || []
    if (!ids.length) { setSay('Nothing to undo here.'); return }
    setOrder((value) => [...ids, ...value.filter((id) => !ids.includes(id))])
    setCurrentId(ids[0])
    setPlaced((value) => Math.max(0, value - ids.length))
    setView('one')
    setSay('Undone. It’s back in Unsorted.')
    actions.showUndo(ids.length > 1 ? `${sayStickies(ids.length)} are back in Unsorted` : 'It’s back in Unsorted', null)
  }

  async function askAi() {
    if (!current || !one.state.canAsk) return
    const note = current
    const candidates = placementPlaces(latest.current, note).slice(0, 60)
    const out = await one.run((ask) => ask(placementMessages(note, candidates)))
    if (!out.ok) return
    const answer = readPlacement(out.result, candidates)
    if (answer) {
      setPicks((value) => ({ ...value, [note.id]: { list: [answer] } }))
      setPick(answer.kind === 'make' ? null : 0)
      setSay(answer.kind === 'make' ? `The AI suggests a new topic, ${answer.name}.` : `The AI suggests ${pathOf(latest.current.folders, answer.folderId)}.`)
    } else if (/^\W*none\b/i.test(String(out.result).trim())) {
      setPicks((value) => ({ ...value, [note.id]: { list: [], sky: true } }))
      setSay('The AI thinks this one can stay free on the canvas.')
    } else one.fail('The AI’s answer didn’t name a place OSAT knows')
  }

  /* Sort them all: the AI (or matching words) suggests a home for each sticky still to sort,
     one line per place. */
  async function sortAll({ whole = false } = {}) {
    setView('all')
    const state = latest.current
    const all = sortQueue(order, notes, { chosen: chosen && !whole })
    const stickies = all.map((id) => notes.find((note) => note.id === id)).filter(Boolean).slice(0, MOST)
    const more = all.length > stickies.length
    if (!stickies.length) { setReview({ groups: [], more: false, from: 'words' }); return }
    if (!bulk.state.canAsk) { setReview({ groups: wordSuggestions(state, stickies), more, from: 'words' }); return }
    const { places, batches } = sortRequests(state, stickies)
    setReview({ groups: [], more, from: 'ai', busy: true, done: 0, total: batches.length })
    const out = await bulk.run(async (ask) => {
      const answers = []
      for (const batch of batches) {
        answers.push({ from: batch.from, text: await ask(batch.messages) })
        setReview((value) => (value ? { ...value, done: answers.length } : value))
      }
      return answers
    })
    if (out.stale) return
    const groups = out.ok ? modelSuggestions(state, stickies, places, out.result) : wordSuggestions(latest.current, stickies)
    setReview({ groups, more, from: out.ok ? 'ai' : 'words' })
  }

  function acceptGroups(groups) {
    if (!groups.length) return
    const result = actions.fileGroups(groups)
    if (!result) { setSay('These stickies changed. Nothing moved.'); return }
    const [only] = groups
    const message = groups.length > 1 ? `Sorted ${sayStickies(result.moved.length)}`
      : only.kind === 'make' ? `Made the topic “${only.name}” with ${sayStickies(result.moved.length)}`
        : `Moved ${sayStickies(result.moved.length)} to ${pathOf(latest.current.folders, only.folderId)}`
    setPlaced((value) => value + result.moved.length)
    setReview((value) => (value ? { ...value, groups: value.groups.filter((group) => !groups.includes(group)) } : value))
    setSay(message)
    actions.showUndo(message, undo)
  }

  function runAction(job, action, retry) {
    if (action === 'setup' || action === 'download') navigate('Settings', { section: 'ai' })
    else if (action === 'resume') ai?.bridge?.resume?.()
    else if (action === 'stop') { job.stop(); if (job === bulk) setReview(null); if (job === bulk) setView('one') }
    else if (action === 'retry') retry()
  }

  const shown = review ? stillToSort(review.groups, workspace) : []
  const total = shown.reduce((sum, group) => sum + group.noteIds.length, 0)

  function onKey(event) {
    const key = event.key
    const typing = inputActive()
    if (key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      if (typing) { setQuery(''); root.current?.focus({ preventScroll: true }); return }
      if (view === 'all') { setView('one'); return }
      onClose()
      return
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && key.toLowerCase() === 'z' && !event.shiftKey && !typing) {
      event.preventDefault(); event.stopPropagation(); undo(); return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (view === 'all') {
      if (key === 'Enter' && !typing && !event.target.closest('button') && !review?.busy && shown.length) { event.preventDefault(); acceptGroups(shown) }
      return
    }
    if (!current) return
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!rows.length) return
      event.preventDefault()
      const from = selected ?? -1
      setPick(key === 'ArrowDown' ? Math.min(rows.length - 1, from + 1) : Math.max(0, from - 1))
      return
    }
    if (key === 'Enter') {
      if (event.target.closest('button') && !event.target.classList.contains('sorter-go')) return
      event.preventDefault()
      place('home')
      return
    }
    if (typing) return
    if (key === 'ArrowRight' && queue[index + 1]) { event.preventDefault(); goTo(queue[index + 1]); return }
    if (key === 'ArrowLeft' && index > 0) { event.preventDefault(); goTo(queue[index - 1]); return }
    if (/^[1-9]$/.test(key) && Number(key) <= numbered) { event.preventDefault(); setPick(Number(key) - 1); return }
    const letter = key.toLowerCase()
    if (letter === 's') { event.preventDefault(); place('sky') }
    else if (letter === 'l') { event.preventDefault(); later() }
    else if (key === 'Backspace' || key === 'Delete') { event.preventDefault(); place('trash') }
    else if (letter === 'a') { event.preventDefault(); askAi() }
    else if (letter === 'n') { event.preventDefault(); setQuery(''); setPick(homes.length); requestAnimationFrame(() => nameField.current?.focus()) }
    else if (letter === 'f' || key === '/') { event.preventDefault(); findField.current?.focus() }
  }

  keys.current = onKey
  const left = queue.length
  // Counted across this sitting: placing one moves on to "Sticky 2 of 3", not back to "1 of 2".
  const position = placed + index + 1
  const nextUp = queue.slice(index + 1, index + 6)

  return (
    <section className="sorter" ref={root} tabIndex={-1} hidden={hidden} aria-label="Sort Unsorted stickies" onKeyDown={onKey}>
      <header className="sorter-bar">
        <h2><Stack aria-hidden="true" /> Sort Unsorted</h2>
        <p className="sorter-progress" title={placed ? `${placed} placed this time` : undefined}>
          {view === 'one' && current
            ? <>Sticky {position} of {placed + left}{chosen && notes.length > left && <span> · picked from {notes.length}</span>}</>
            : notes.length ? `${sayStickies(notes.length)} in Unsorted` : 'Nothing in Unsorted'}
        </p>
        <div className="sorter-bar-actions">
          {view === 'one'
            ? <button type="button" disabled={!left} onClick={() => sortAll()}><Sparkle /> Suggest homes for all</button>
            : <button type="button" onClick={() => setView('one')}>One at a time</button>}
          <button type="button" onClick={onBrowse}>See the list</button>
          <button type="button" className="sorter-close" aria-label="Close Unsorted" onClick={onClose}><X /></button>
        </div>
      </header>

      {view === 'all' ? (
        <div className="sorter-review" aria-label="Suggested homes">
          <h3>Suggested homes</h3>
          <AiLine state={bulk.state} onAction={(action) => runAction(bulk, action, () => sortAll())}
            line={review?.busy ? `Asking the AI · part ${Math.min((review.done || 0) + 1, review.total)} of ${review.total}${bulk.state.key === 'waking' ? ` · ${bulk.state.line}` : ''}`
              : review?.from === 'ai' ? 'The AI suggested these. Nothing moves until you say so.' : ''} />
          {review && !review.busy && shown.length > 0 && (
            <p className="sorter-summary">
              {total === 1 ? '1 sticky has' : `${total} stickies have`} a suggested home.
              {left > total && <> The other {left - total === 1 ? 'one has' : `${left - total} have`} no clear home yet and stay in Unsorted.</>}
              {' '}Nothing moves until you say so.
            </p>
          )}
          {review && !review.busy && (shown.length ? (
            <ul className="sorter-groups">
              {shown.map((group) => (
                <li key={group.key}>
                  <div>
                    <strong>{group.kind === 'make'
                      ? <>Make a node “{group.name}” for {sayStickies(group.noteIds.length)}</>
                      : <>Move {sayStickies(group.noteIds.length)} to {pathOf(workspace.folders, group.folderId)}</>}</strong>
                    <span className="sorter-group-stickies">
                      {group.noteIds.slice(0, 5).map((id) => <span key={id} className="sorter-chip" data-paper={byId.get(id)?.color || 'canary'} title={byId.get(id)?.title}>{byId.get(id)?.title || 'Untitled'}</span>)}
                      {group.noteIds.length > 5 && <small>and {group.noteIds.length - 5} more</small>}
                    </span>
                  </div>
                  <button type="button" className="sorter-group-go" onClick={() => acceptGroups([group])}>Do it</button>
                  <button type="button" onClick={() => setReview((value) => ({ ...value, groups: value.groups.filter((item) => item.key !== group.key) }))}>Not this</button>
                </li>
              ))}
            </ul>
          ) : <p className="sorter-quiet-line">{left ? 'Nothing in the pile looks like it goes together yet. Go through them one at a time instead.' : 'Everything is sorted.'}</p>)}
          <div className="sorter-review-actions">
            {shown.length > 0 && !review?.busy && <button type="button" className="is-primary" onClick={() => acceptGroups(shown)}>Do all of these · {sayStickies(total)} <kbd aria-hidden="true">↵</kbd></button>}
            <button type="button" onClick={() => setView('one')}>One at a time instead</button>
          </div>
          {review?.more && !review.busy && <p className="sorter-quiet-line">That was the first {MOST}. Run it again for the rest. Anything not listed stays in Unsorted.</p>}
        </div>
      ) : current ? (
        <div className="sorter-stage">
          <h3 className="sorter-question">Where does this sticky go?</h3>
          <div className="sorter-sticky">
            <article key={current.id} className="sorter-paper" data-paper={current.color || 'canary'}>
              <textarea
                key={`${current.id}:${current.markdown}`}
                className="sorter-edit"
                aria-label="Edit this sticky"
                defaultValue={current.markdown}
                spellCheck
                onBlur={(event) => { if (event.target.value.trim()) writeSticky(actions.commit, current, event.target.value) }}
              />
            </article>
            <p className="sorter-meta">
              <span>{[current.source && `From ${current.source}`, formatRelativeTime(current.createdAt)].filter(Boolean).join(' · ')}</span>
              <button type="button" onClick={() => actions.openNote(current.id)}>Open in Notes <ArrowUpRight /></button>
            </p>
            <div className="sorter-quiet" aria-label="Or">
              <button type="button" onClick={later}>Skip for now <kbd aria-hidden="true">L</kbd></button>
              <button type="button" title="On the canvas, in no topic" onClick={() => place('sky')}>Put it on the canvas <kbd aria-hidden="true">S</kbd></button>
              <button type="button" onClick={() => place('trash')}>Delete <kbd aria-hidden="true">⌫</kbd></button>
            </div>
          </div>

          <div className="sorter-homes">
            <h4 id="sorter-homes-title">{query.trim() ? `Places matching “${query.trim()}”` : homes.length ? 'Suggested places' : newNode ? 'Suggested: a new topic' : 'No suggestion for this one'}</h4>
            {!query.trim() && !homes.length && !newNode && <p className="sorter-quiet-line">{aiPick?.sky ? 'The AI thinks it can stay free on the canvas.' : 'Search for a topic or branch below, or make a new topic.'}</p>}
            <div className="sorter-list" role="listbox" aria-labelledby="sorter-homes-title" aria-activedescendant={row ? `sorter-row-${selected}` : undefined}>
              {rows.map((item, at) => item.kind === 'make' ? (
                <div key="make" id={`sorter-row-${at}`} role="option" aria-selected={selected === at} className="sorter-row is-new" onClick={() => { setPick(at); nameField.current?.focus() }}>
                  <kbd aria-hidden="true">N</kbd>
                  <div>
                    <label><Plus aria-hidden="true" /> New topic <input ref={nameField} value={item.name} maxLength={80} placeholder="Name it" aria-label="New topic name" onFocus={() => setPick(at)} onChange={(event) => setNames((value) => ({ ...value, [current.id]: event.target.value }))} /></label>
                    {item.why && <small>{item.why}</small>}
                  </div>
                </div>
              ) : (
                <div key={item.key} id={`sorter-row-${at}`} role="option" aria-selected={selected === at} className="sorter-row" data-from={item.from} onClick={() => setPick(at)} onDoubleClick={() => place('home', item)}>
                  <kbd aria-hidden="true">{at + 1}</kbd>
                  <div>
                    <strong>{item.path.replaceAll(' / ', ' › ')}</strong>
                    <small>
                      {item.from === 'ai' && <Sparkle weight="fill" aria-label="The AI" />}
                      {[item.why, item.count === null ? '' : item.count ? `${sayStickies(item.count)}: ${item.peek.map((title) => `“${title}”`).join(', ')}` : 'Nothing in it yet'].filter(Boolean).join(' · ')}
                    </small>
                  </div>
                </div>
              ))}
              {query.trim() && !found.length && <p className="sorter-quiet-line">No topic or branch is called that. Esc clears the search.</p>}
            </div>
            <label className="sorter-find">
              <MagnifyingGlass aria-hidden="true" />
              <input ref={findField} value={query} placeholder="Search for a topic or branch…" aria-label="Find another topic or branch" onChange={(event) => { setQuery(event.target.value); setPick(null) }} />
              <kbd aria-hidden="true">F</kbd>
            </label>
            <button type="button" className="is-primary sorter-go" disabled={row && !ready} onClick={() => place('home')}>
              <span>{!row ? 'Put it on the canvas' : row.kind === 'make' ? (row.name.trim() ? `Make the topic “${row.name.trim()}”` : 'Name the new topic') : `Move to ${row.path.replaceAll(' / ', ' › ')}`}</span>
              <kbd aria-hidden="true">↵</kbd>
            </button>
            <AiLine state={one.state} onAsk={askAi} onAction={(action) => runAction(one, action, askAi)} />
          </div>
        </div>
      ) : (
        <div className="sorter-done">
          <Check aria-hidden="true" />
          <h3>{notes.length ? 'Those are done.' : 'All sorted.'}</h3>
          <p>{notes.length ? `${sayStickies(notes.length)} still wait in Unsorted, whenever you like.` : 'Every sticky has a place. New ones will wait here.'}</p>
          <div>
            {notes.length > 0 && <button type="button" className="is-primary" onClick={() => { setOrder([]); setChosen(false); setCurrentId(null) }}>Sort the rest</button>}
            <button type="button" onClick={onClose}>Back to the canvas</button>
          </div>
        </div>
      )}

      <footer className="sorter-foot">
        {view === 'one' && nextUp.length > 0 && (
          <div className="sorter-next" aria-label="Next up">
            <span>Next up</span>
            {nextUp.map((id) => (
              <button type="button" key={id} className="sorter-chip" data-paper={byId.get(id).color || 'canary'} title={byId.get(id).title} onClick={() => goTo(id)}>{byId.get(id).title || 'Untitled'}</button>
            ))}
            {left - index - 1 > nextUp.length && <small>and {left - index - 1 - nextUp.length} more</small>}
          </div>
        )}
        {/* The keys that matter; the rest are in the tooltip. */}
        <p className="sorter-keys" aria-hidden="true"
          title={view === 'one' ? `↵ Move · ↑↓${numbered > 0 ? ` or ${numbered > 1 ? `1–${Math.min(9, numbered)}` : '1'}` : ''} Choose · N New topic · F Search · L Skip for now · S Put it on the canvas · ⌫ Delete · A Ask the AI · ←→ Look through · ⌘Z Undo · Esc Close` : undefined}>
          {view === 'one'
            ? <><b>↵</b> Move · <b>↑↓</b> Choose · <b>L</b> Skip · <b>⌘Z</b> Undo · <b>Esc</b> Close</>
            : <><b>↵</b> Do all of these · <b>⌘Z</b> Undo · <b>Esc</b> One at a time</>}
        </p>
        <p className="sorter-say" role="status" aria-live="polite">{say}</p>
      </footer>
    </section>
  )
}

/* What the AI can do right now, in one calm line, with its way forward. */
function AiLine({ state, line = '', onAsk, onAction }) {
  return (
    <p className="sorter-ai" data-state={state.key} role="status">
      <Sparkle weight={state.busy ? 'fill' : 'regular'} aria-hidden="true" />
      <span>{line || state.line}</span>
      {onAsk && state.canAsk && !state.busy && state.action !== 'retry' && <button type="button" onClick={onAsk}>Ask the AI <kbd aria-hidden="true">A</kbd></button>}
      {state.action && <button type="button" onClick={() => onAction(state.action)}>{actionLabel(state.action)}</button>}
    </p>
  )
}
