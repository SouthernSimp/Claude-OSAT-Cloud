import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowUp, CaretDown, ChatCircle, CheckCircle, MagnifyingGlass, MoonStars, NotePencil, PencilSimpleLine, Plus, PushPin, ShareNetwork, Sparkle, Stop, X } from '@phosphor-icons/react'

import { FocusEnvironment } from '../Experience.jsx'
import { applyAction, extractActions, systemPrompt, wantsActions } from '../assistant/actions.js'
import { newChat, newMessage, outbound, putChat } from '../assistant/chats.js'
import { ActionCards, UsedNotes, modelLabel } from '../assistant/LocalAssistant.jsx'
import { cleanError, setupLine, useAi } from '../assistant/useAi.js'
import { calendarMonthDays, localDateKey } from '../daily-practice.js'
import { streamLocalMessage } from '../local-ai.js'
import { Markdown } from '../lib/markdown.jsx'
import { captureThought, dayNoteId, excerpt, isActiveNote, relatedNotes, relinkRenamedNote, updateNote, wikilinkPairs } from '../notes-model.js'
import { addNextStep, bringForward, earlierSteps, nextSteps, toggleNextStep } from '../next-steps.js'
import { clamp, inputActive, timeLabel } from '../lib/ui.js'
import { sampleEvents, sampleFolders, sampleNotes } from './field-sample.js'
import { FieldBanner, useReducedMotion } from './FieldChrome.jsx'
import { FieldSheet } from './FieldSheet.jsx'
import { dayPhase, fitCells, homeItems, paperFields, phaseCopy } from './field-model.js'
import { MediaWidget } from './MediaWidget.jsx'

const MODES = [
  { id: 'note', label: 'Note', icon: NotePencil, placeholder: 'Leave a thought here.', hint: 'Return saves a note' },
  { id: 'step', label: 'Next step', icon: CheckCircle, placeholder: 'One small next step…', hint: 'Return adds a step' },
  { id: 'ask', label: 'Ask', icon: Sparkle, placeholder: 'Ask your notes, or anything…', hint: 'Return asks, right here' },
  { id: 'find', label: 'Search', icon: MagnifyingGlass, placeholder: 'Search notes, #tags and folders…', hint: 'Return searches' },
]
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long' })
const ICONS_KEY = 'osat.home.icons.v1'
const CELL = { h: 103 }
/* Blue hour for the morning and evening, the peaks at midday, the lake at night. */
const WALL_FOCUS = { morning: '18% 45%', afternoon: '55% 50%', evening: '18% 45%', night: '75% 40%' }

/* The evening invitation shows once a day, and never again that day once opened. */
function readEvening() {
  try { return localStorage.getItem('osat.evening') } catch { return null }
}
function markEvening(date) {
  try { localStorage.setItem('osat.evening', date) } catch { /* a convenience only */ }
}

function readIconsCollapsed() {
  try {
    return localStorage.getItem(ICONS_KEY) === 'collapsed'
  } catch {
    return false
  }
}

/* Home is a quiet desktop: a blurred wallpaper, two small widgets and the
   next steps, one line that does one thing on Return, your notes as icons,
   and a dock to the rooms. It reads and writes the same records the rest of
   OSAT keeps. The ⌥Space layer reuses it with `layer`: no wallpaper (the real
   desktop shows through), its own dock, and notes open as pop-outs. On the
   layer, widgets and icons can be picked up and set down anywhere (`places`). */
export function FieldDesk({
  workspace, commit, navigate, preview, sampled, onKeep, onBlank, onRemove, sheet, onSheetDone,
  storage, onSearch, wallpaper, focusAt, layer = false, dock, onOpenNote, visit, places = {}, onPlace, media,
}) {
  const home = useRef(null)
  const justMoved = useRef(false)
  const box = useRef(null)
  const grid = useRef(null)
  const reduced = useReducedMotion()
  const [now, setNow] = useState(() => new Date())
  const [mode, setMode] = useState('note')
  const [draft, setDraft] = useState('')
  const [freshId, setFreshId] = useState(null)
  const [ghosts, setGhosts] = useState(() => new Set())
  const [arrived] = useState(() => reduced || sessionStorage.getItem('osat.field.arrived') === '1')
  const [capacity, setCapacity] = useState(21)
  const [collapsed, setCollapsed] = useState(readIconsCollapsed)
  const [focusOpen, setFocusOpen] = useState(false)
  const [openId, setOpenId] = useState(null)
  const { models, status: aiStatus, refresh: checkAi } = useAi()
  const [answer, setAnswer] = useState(null)
  const answerAbort = useRef(null)
  const [hoverId, setHoverId] = useState(null)
  const [eveningSeenOn, setEveningSeenOn] = useState(readEvening)
  const openRef = useRef(null)
  const focusRef = useRef(false)
  focusRef.current = focusOpen

  const phase = dayPhase(now)
  const today = localDateKey(now)
  const [greeting] = phaseCopy(phase)
  const realNotes = workspace.notes.filter(isActiveNote)
  const notes = preview ? sampleNotes() : realNotes
  const planId = dayNoteId(today)
  // Steps left on earlier daily pages wait to be brought forward, not piled on here.
  const earlier = earlierSteps(notes, today)
  const earlierIds = new Set(earlier.map((step) => step.id))
  const steps = nextSteps(notes)
    .filter((step) => (!step.done || ghosts.has(step.id)) && !earlierIds.has(step.id))
    .sort((a, b) => (b.noteId === planId) - (a.noteId === planId))
  const openCount = steps.filter((step) => !step.done).length
  const allEvents = preview ? sampleEvents() : workspace.calendar.events
  const events = allEvents
    .filter((event) => localDateKey(new Date(event.start)) === today)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const allItems = homeItems({ notes, folders: preview ? sampleFolders() : workspace.folders, boards: workspace.sorter?.boards || [] })
  const placed = (item) => Boolean(places[`${item.kind}:${item.id}`])
  const items = fitCells(allItems.filter((item) => !placed(item)), capacity)
  const placedItems = allItems.filter(placed)

  /* Resting on a note lights up the notes it links to, and their folders. */
  const pairs = useMemo(() => wikilinkPairs(notes), [notes])
  const linked = new Set(hoverId ? pairs.flatMap((pair) => (pair.a === hoverId ? [pair.b] : pair.b === hoverId ? [pair.a] : [])) : [])
  const linkedFolders = new Set(notes.filter((note) => linked.has(note.id) && note.folderId).map((note) => note.folderId))
  const sheetNote = notes.find((item) => item.id === openId) || null
  openRef.current = sheetNote ? openId : null
  const current = MODES.find((item) => item.id === mode)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!arrived) sessionStorage.setItem('osat.field.arrived', '1')
  }, [arrived])

  /* Each time the layer is shown the line is back on Note and ready to type into. */
  useEffect(() => {
    if (!visit) return
    setMode('note')
    box.current?.focus()
  }, [visit])

  useEffect(() => {
    if (focusAt) setFocusOpen(true)
  }, [focusAt])

  useEffect(() => {
    if (!sheet?.id) return
    setOpenId(sheet.id)
    onSheetDone?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, sheet?.at])

  /* The icon grid shows as many cells as fit; it never scrolls. */
  useEffect(() => {
    const node = grid.current
    if (!node) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const { height } = entry.contentRect
      const cols = Math.max(1, getComputedStyle(node).gridTemplateColumns.split(' ').length)
      const rows = Math.max(1, Math.floor(height / CELL.h))
      setCapacity(cols * rows)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [collapsed])

  /* Ask only ever talks to the model on this Mac. */
  const ai = models === null ? { state: 'checking', label: '' } : models.length ? { state: 'ready', label: modelLabel(models[0]), id: models[0].id } : { state: 'none', label: '' }

  /* Esc puts an answer away before anything else. */
  useEffect(() => {
    if (!answer) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.documentElement.dataset.menu === 'open') return
      if (home.current?.closest('[inert]') || event.target.closest?.('.popout, .room-sheet, [role="dialog"]')) return
      event.preventDefault()
      closeAnswer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answer]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => answerAbort.current?.abort(), [])

  /* Ask, right here: the answer streams into a card under the line and is kept as a chat. */
  async function askHere(question) {
    answerAbort.current?.abort()
    const active = workspace.notes.filter(isActiveNote)
    const noteIds = relatedNotes(active, question).map((note) => note.id)
    const chat = { ...newChat(), messages: [newMessage('user', question, noteIds.length ? { noteIds } : {})] }
    commit((state) => putChat(state, chat))
    const controller = new AbortController()
    answerAbort.current = controller
    const update = (patch) => setAnswer((value) => (value?.chatId === chat.id ? { ...value, ...patch } : value))
    setAnswer({ chatId: chat.id, question, text: '', busy: true, error: '', noteIds, actions: [], savedId: null })
    let full = ''
    try {
      await streamLocalMessage({
        model: ai.id,
        messages: outbound(systemPrompt(), [], question, active, noteIds),
        signal: controller.signal,
        onDelta: (delta) => { full += delta; update({ text: extractActions(full).body }) },
      })
    } catch (reason) {
      if (reason?.name !== 'AbortError') update({ error: cleanError(reason) })
    }
    const { body, actions } = extractActions(full)
    update({ busy: false, text: body, actions: wantsActions(question) ? actions : [] })
    if (!body.trim()) return
    commit((state) => {
      const saved = (state.chats || []).find((item) => item.id === chat.id) || chat
      return putChat(state, { ...saved, messages: [...saved.messages, newMessage('assistant', body)] })
    })
  }

  function closeAnswer() {
    answerAbort.current?.abort()
    setAnswer(null)
    box.current?.focus()
  }

  function saveAnswer() {
    if (!answer?.text.trim()) return
    let note
    commit((state) => {
      const result = captureThought(state, `${answer.question.slice(0, 80)}\n\n${answer.text.trim()}`, 'Ask')
      note = result.note
      return result.state
    })
    if (note) setAnswer((value) => (value ? { ...value, savedId: note.id } : value))
  }

  /* Type anywhere on home and the words land in the line. */
  useEffect(() => {
    const onKey = (event) => {
      if (openRef.current || focusRef.current) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || inputActive()) return
      if (box.current?.closest('[inert]')) return
      if (event.key === ' ' && document.activeElement && document.activeElement !== document.body) return
      event.preventDefault()
      box.current?.focus()
      setDraft((value) => value + event.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function choose(id, focusLine = true) {
    setMode(id)
    if (id === 'ask' && ai.state !== 'ready') checkAi()
    if (focusLine) box.current?.focus()
  }

  function onModeKey(event) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const index = MODES.findIndex((item) => item.id === mode)
    const next = MODES[(index + step + MODES.length) % MODES.length]
    choose(next.id, false)
    event.currentTarget.querySelector(`[data-mode="${next.id}"]`)?.focus()
  }

  function submit(event) {
    event?.preventDefault()
    const text = draft.trim().slice(0, 8000)
    if (!text) return
    if (mode === 'ask') {
      if (ai.state !== 'ready') return
      askHere(text)
    } else if (mode === 'find') {
      onSearch(text)
    } else if (mode === 'step') {
      commit((state) => addNextStep(state, text.replace(/\s*\n\s*/g, ' ').slice(0, 240), localDateKey()))
    } else {
      let note
      commit((state) => {
        const result = captureThought(state, text, 'Home')
        note = result.note
        return result.state
      })
      if (note) setFreshId(note.id)
    }
    setDraft('')
    if (box.current) box.current.style.height = ''
  }

  function toggleStep(step) {
    if (preview) return
    commit((state) => ({ ...state, notes: toggleNextStep(state.notes, step) }))
    if (step.done) return
    setGhosts((value) => new Set(value).add(step.id))
    window.setTimeout(() => {
      if (document.activeElement?.closest('.widget-next li.is-done')) document.getElementById('widget-next')?.focus()
    }, 1380)
    window.setTimeout(() => setGhosts((value) => {
      const next = new Set(value)
      next.delete(step.id)
      return next
    }), 1400)
  }

  /* Opening and setting down morph the icon's page into the sheet and back. */
  function openNote(id, paper = null) {
    if (onOpenNote) {
      onOpenNote(id)
      return
    }
    if (reduced || !document.startViewTransition) {
      setOpenId(id)
      return
    }
    if (paper) paper.style.viewTransitionName = 'open-paper'
    const run = document.startViewTransition(() => {
      if (paper) paper.style.viewTransitionName = ''
      flushSync(() => setOpenId(id))
    })
    run.finished.finally(() => { if (paper) paper.style.viewTransitionName = '' })
  }

  function closeSheet() {
    const id = openRef.current
    const paper = id ? grid.current?.querySelector(`[data-paper="${CSS.escape(id)}"]`) : null
    onSheetDone?.()
    if (reduced || !document.startViewTransition) {
      setOpenId(null)
      return
    }
    const run = document.startViewTransition(() => {
      if (paper) paper.style.viewTransitionName = 'open-paper'
      flushSync(() => setOpenId(null))
    })
    run.finished.finally(() => { if (paper) paper.style.viewTransitionName = '' })
  }

  function openItem(item, event) {
    if (item.kind === 'note') openNote(item.id, event.currentTarget.querySelector('[data-paper]'))
    else if (item.kind === 'folder') navigate('Notes', preview ? null : { folderId: item.id })
    else if (item.kind === 'board') navigate('Mindmap', { boardId: item.id })
    else if (item.kind === 'pile') navigate('Notes', { list: 'unsorted' })
    else navigate('Notes')
  }

  function toggleIcons() {
    setCollapsed((value) => {
      try { localStorage.setItem(ICONS_KEY, value ? 'open' : 'collapsed') } catch { /* a convenience only */ }
      return !value
    })
  }

  /* Pick a widget or icon up and set it down anywhere, like a sticky. A press
     that barely moves is still a click. */
  function movable(id) {
    if (!onPlace) return {}
    const spot = places[id]
    return {
      'data-placed': spot ? '' : undefined,
      style: spot ? { position: 'absolute', left: `${spot.x * 100}%`, top: `${spot.y * 100}%` } : undefined,
      onClickCapture: (event) => {
        if (!justMoved.current) return
        event.preventDefault()
        event.stopPropagation()
      },
      onPointerDown: (event) => {
        if (event.button !== 0 || event.target.closest('textarea, input')) return
        const element = event.currentTarget
        const box = home.current.getBoundingClientRect()
        const from = element.getBoundingClientRect()
        const start = { x: event.clientX, y: event.clientY }
        let shift = null
        const move = (next) => {
          const dx = next.clientX - start.x
          const dy = next.clientY - start.y
          if (!shift && Math.hypot(dx, dy) < 5) return
          shift = { x: clamp(dx, box.left - from.left, box.right - from.right), y: clamp(dy, box.top - from.top, box.bottom - from.bottom) }
          element.classList.add('is-moving')
          element.style.translate = `${shift.x}px ${shift.y}px`
        }
        const end = (last) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
          element.classList.remove('is-moving')
          element.style.translate = ''
          if (!shift || last.type === 'pointercancel') return
          justMoved.current = true
          window.setTimeout(() => { justMoved.current = false })
          onPlace(id, { x: (from.left + shift.x - box.left) / box.width, y: (from.top + shift.y - box.top) / box.height })
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
      },
    }
  }

  function renderIcon(item) {
    const key = `${item.kind}:${item.id}`
    return (
      <button
        key={key}
        type="button"
        className={`icon is-${item.kind} ${(item.kind === 'note' && item.id === freshId) || (item.kind === 'pile' && item.notes.some((note) => note.id === freshId)) ? 'is-fresh' : ''} ${linked.has(item.id) || (item.kind === 'folder' && linkedFolders.has(item.id)) ? 'is-linked' : ''}`}
        aria-label={item.kind === 'note' ? `Open note ${item.note.title}` : item.kind === 'folder' ? `Open folder ${item.folder.name}` : item.kind === 'board' ? 'Open the Map' : item.kind === 'pile' ? `${item.count} loose thoughts. Open Unsorted` : `See ${item.count} more notes`}
        onClick={(event) => openItem(item, event)}
        onPointerEnter={item.kind === 'note' ? () => setHoverId(item.id) : undefined}
        onPointerLeave={item.kind === 'note' ? () => setHoverId((id) => (id === item.id ? null : id)) : undefined}
        {...(item.kind === 'more' ? {} : movable(key))}
      >
        <IconArt item={item} />
        <span className="icon-label">{item.kind === 'note' ? item.note.title : item.kind === 'folder' ? item.folder.name : item.kind === 'board' ? 'Map' : item.kind === 'pile' ? `${item.count} loose thoughts` : `${item.count} more`}</span>
      </button>
    )
  }

  const chip = mode === 'note'
    ? { tone: storage?.status === 'error' ? 'bad' : 'good', text: storage?.status === 'error' ? 'Check storage' : 'Saved privately on this Mac' }
    : mode === 'step'
      ? (storage?.status === 'error' ? { tone: 'bad', text: 'Check storage' } : { tone: 'good', text: 'Adds to today’s plan' })
      : mode === 'find'
        ? { tone: 'quiet', text: 'Opens search with these words' }
        : ai.state === 'ready'
          ? { tone: 'good', text: `${ai.label} · on this Mac · no cloud` }
          : ai.state === 'checking'
            ? { tone: 'quiet', text: 'Looking for the AI on this Mac…' }
            : setupLine(aiStatus)
              ? { tone: 'quiet', text: setupLine(aiStatus), setup: true }
              : { tone: 'bad', text: 'No AI on this Mac yet', setup: true }
  const blocked = mode === 'ask' && ai.state !== 'ready'

  return (
    <div ref={home} className={`home ${layer ? 'is-layer' : ''} ${arrived ? '' : 'is-arriving'} ${collapsed ? 'icons-collapsed' : ''}`} data-phase={phase} data-wall={wallpaper}>
      {!layer && (
        <div className="home-wall" aria-hidden="true">
          <img src={wallpaper === 'moss' ? './images/wall-moss.jpg' : './images/wall-lake.jpg'} alt="" decoding="async" style={{ objectPosition: wallpaper === 'moss' ? '50% 62%' : WALL_FOCUS[phase] }} />
        </div>
      )}

      <aside className="home-widgets" aria-label="Today at a glance">
        <DayWidget now={now} events={events} onOpen={() => navigate('Calendar', { date: today })} move={movable('widget:day')} />
        <MonthWidget now={now} today={today} events={allEvents} onOpen={() => navigate('Calendar', { date: today })} move={movable('widget:month')} />
        <section className="glass widget widget-next" aria-labelledby="widget-next" {...movable('widget:next')}>
          <h2 id="widget-next" tabIndex={-1} className="widget-kicker">Next <small>{openCount ? `${openCount} open` : ''}</small></h2>
          {steps.length ? (
            <ul>
              {steps.slice(0, 5).map((step) => (
                <li key={step.id} className={step.done ? 'is-done' : ''}>
                  <button type="button" className="ring" aria-label={`Complete ${step.text}`} aria-pressed={step.done} disabled={preview} onClick={() => toggleStep(step)} />
                  <button type="button" className="step-text" onClick={() => openNote(step.noteId)}>{step.text}</button>
                </li>
              ))}
            </ul>
          ) : <p className="widget-empty">Nothing waiting. Choose Next step to add one.</p>}
          {(steps.length > 5 || (earlier.length > 0 && !preview)) && (
            <div className="widget-next-foot">
              {steps.length > 5 && <button type="button" onClick={() => navigate('Journal')}>{steps.length - 5} more on today’s page</button>}
              {earlier.length > 0 && !preview && (
                <button type="button" className="bring" onClick={() => commit((state) => bringForward(state, localDateKey()))}>
                  Bring {earlier.length} from earlier days
                </button>
              )}
            </div>
          )}
        </section>
        {media && <MediaWidget media={media} visit={visit} move={movable('widget:media')} />}
      </aside>

      <div className="home-center">
        <div className="home-modes">
          <button type="button" className="glass pod" aria-label="New chat with local AI" title="New chat with local AI" onClick={() => navigate('Assistant', { prompt: '' })}>
            <PencilSimpleLine />
          </button>
          <div className="glass mode-pill" role="radiogroup" aria-label="What Return does" onKeyDown={onModeKey}>
            {MODES.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="radio" data-mode={id} aria-checked={mode === id} tabIndex={mode === id ? 0 : -1} onClick={() => choose(id)}>
                <Icon weight={mode === id ? 'bold' : 'regular'} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <h1 className="home-greeting">{greeting}</h1>

        <form className="home-composer-wrap" onSubmit={submit}>
          <div className={`glass home-composer ${draft.trim() ? 'has-text' : ''}`}>
            <label className="visually-hidden" htmlFor="home-line">{current.label}</label>
            <textarea
              id="home-line"
              ref={box}
              rows={2}
              value={draft}
              maxLength={mode === 'step' ? 240 : 8000}
              placeholder={current.placeholder}
              onChange={(event) => {
                setDraft(event.target.value)
                const el = event.target
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 180)}px`
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit(event)
                }
              }}
            />
            <div className="home-composer-bar">
              <span>{blocked ? 'Ask needs the AI on this Mac' : `${current.hint} · Shift-Return for a new line`}</span>
              <button type="submit" aria-label={current.label} disabled={!draft.trim() || blocked}>
                <ArrowUp weight="bold" />
              </button>
            </div>
          </div>
          <p className={`home-chip is-${chip.tone}`} role="status">
            <i />
            {chip.text}
            {chip.setup && <button type="button" onClick={() => navigate('Settings', { section: 'ai' })}>Set it up</button>}
          </p>
          {(phase === 'evening' || phase === 'night') && !preview && eveningSeenOn !== today && (
            <button type="button" className="glass evening-pill" onClick={() => { markEvening(today); setEveningSeenOn(today); navigate('Reflection') }}>
              <MoonStars weight="fill" /> Close the day <span>three quiet questions</span>
            </button>
          )}
          <FieldBanner preview={preview} sampled={sampled} onKeep={() => onKeep()} onBlank={onBlank} onRemove={onRemove} />
        </form>
        {answer && (
          <section className="glass home-answer" aria-label="Answer" aria-busy={answer.busy}>
            <header>
              <Sparkle weight="fill" />
              <strong>{answer.question}</strong>
              <button type="button" aria-label="Put the answer away" onClick={closeAnswer}><X /></button>
            </header>
            <div className="home-answer-body" aria-live="polite">
              {answer.text ? <Markdown text={answer.text} headingOffset={2} /> : answer.busy && <p className="home-answer-wait">Thinking on this Mac…</p>}
              {answer.error && <p className="home-answer-error" role="alert">{answer.error}</p>}
            </div>
            <UsedNotes ids={answer.noteIds} notes={notes} onOpen={(noteId) => openNote(noteId)} />
            <ActionCards
              actions={answer.actions}
              onAdd={(action) => { commit((state) => applyAction(state, action, localDateKey())); setAnswer((value) => ({ ...value, actions: value.actions.filter((item) => item.id !== action.id) })) }}
              onDiscard={(action) => setAnswer((value) => ({ ...value, actions: value.actions.filter((item) => item.id !== action.id) }))}
            />
            <footer>
              {answer.busy
                ? <button type="button" onClick={() => answerAbort.current?.abort()}><Stop weight="fill" /> Stop</button>
                : <button type="button" onClick={() => { const chatId = answer.chatId; setAnswer(null); navigate('Assistant', { chatId }) }}><ChatCircle /> Keep talking</button>}
              {!answer.busy && answer.text.trim() && (
                answer.savedId
                  ? <span className="home-answer-saved"><NotePencil /> Saved to Unsorted</span>
                  : <button type="button" onClick={saveAnswer}><NotePencil /> Save as a note</button>
              )}
            </footer>
          </section>
        )}
      </div>

      <nav className={`home-icons ${preview ? 'is-sample' : ''}`} aria-label="OSAT items">
        <button type="button" className="icons-toggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Show notes and folders' : 'Hide notes and folders'} onClick={toggleIcons}>
          <CaretDown weight="bold" />
        </button>
        {!collapsed && (
          <div className="icon-grid" ref={grid}>
            {items.map(renderIcon)}
            {items.every((item) => item.kind === 'board') && (
              <div className="icons-empty">
                <p>Your notes will appear here.</p>
                {!sampled && !layer && <button type="button" onClick={() => onKeep()}>Or lay out a sample room</button>}
              </div>
            )}
          </div>
        )}
        {placedItems.map(renderIcon)}
      </nav>

      {dock}

      {sheetNote && (
        <FieldSheet
          note={sheetNote}
          preview={preview}
          onClose={closeSheet}
          onCommit={(id, patch) => commit((state) => {
            const before = state.notes.find((item) => item.id === id)
            const next = updateNote(state, id, patch)
            return before && patch.title !== undefined && patch.title !== before.title ? relinkRenamedNote(next, before.title, patch.title) : next
          })}
          onKeep={onKeep}
          onOpenNotes={() => { setOpenId(null); onSheetDone?.(); navigate('Notes', { noteId: sheetNote.id }) }}
        />
      )}
      {focusOpen && (
        <FocusEnvironment
          session={workspace.focus}
          task={steps.find((step) => !step.done)?.text}
          onChange={(focus) => commit((state) => ({ ...state, focus }))}
          close={() => setFocusOpen(false)}
        />
      )}
    </div>
  )
}

function DayWidget({ now, events, onOpen, move }) {
  return (
    <section className="glass widget widget-day" aria-label="Today" {...move}>
      <p className="widget-kicker">{WEEKDAY.format(now)}</p>
      <strong className="widget-date">{now.getDate()}</strong>
      <div className="widget-day-foot">
        {events.length ? (
          <ul>
            {events.slice(0, 2).map((event) => (
              <li key={event.id}><time dateTime={event.start}>{timeLabel(event.start)}</time><span>{event.title}</span></li>
            ))}
          </ul>
        ) : <p className="widget-empty">Nothing planned</p>}
        <button type="button" aria-label="Open today in Calendar" title="Open today in Calendar" onClick={onOpen}><Plus weight="bold" /></button>
      </div>
    </section>
  )
}

function MonthWidget({ now, today, events, onOpen, move }) {
  const busy = new Set(events.map((event) => localDateKey(new Date(event.start))))
  const cells = calendarMonthDays(now.getFullYear(), now.getMonth())
  const weeks = Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7)).filter((week) => week.some((day) => day.inMonth))
  return (
    <button type="button" className="glass widget widget-month" aria-label={`${MONTH.format(now)}. Open the calendar`} onClick={onOpen} {...move}>
      <span className="widget-kicker">{MONTH.format(now)}</span>
      <span className="mini-month" aria-hidden="true">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <b key={index}>{day}</b>)}
        {weeks.flat().map((day) => (
          <i key={day.key} className={`${day.inMonth ? '' : 'is-out'} ${day.key === today ? 'is-today' : ''} ${busy.has(day.key) && day.inMonth ? 'is-busy' : ''}`}>{day.inMonth ? day.date.getDate() : ''}</i>
        ))}
      </span>
    </button>
  )
}

function IconArt({ item }) {
  if (item.kind === 'folder') {
    return (
      <svg className="art-folder" viewBox="0 0 56 46" aria-hidden="true">
        <path d="M4 9.5A4.5 4.5 0 0 1 8.5 5h12.2c1.2 0 2.3.5 3.2 1.3L27.6 10H48a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor" opacity=".7" />
        <path d="M4 16.5a4 4 0 0 1 4-4h40a4 4 0 0 1 4 4V38a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor" />
        <path d="M8 13.4h40" stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
      </svg>
    )
  }
  if (item.kind === 'board') {
    return <span className="art-board" aria-hidden="true"><ShareNetwork weight="bold" /></span>
  }
  if (item.kind === 'more') return <span className="art-more" aria-hidden="true">+{item.count}</span>
  if (item.kind === 'pile') {
    return (
      <span className="art-pile" aria-hidden="true">
        {item.notes.slice(0, 3).reverse().map((note, index) => (
          <span key={note.id} className="art-note" style={{ '--i': index }}><b>{note.title}</b><em /><em /></span>
        ))}
      </span>
    )
  }
  const { note } = item
  const lines = excerpt(paperFields(note).body, 70)
  return (
    <span className={`art-note ${note.pinned ? 'is-pinned' : ''}`} data-paper={note.id} aria-hidden="true">
      {note.pinned && <PushPin weight="fill" />}
      <b>{note.title}</b>
      {lines ? <small>{lines}</small> : <><em /><em /><em /></>}
    </span>
  )
}
