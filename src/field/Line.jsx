import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow, ArrowUp, CalendarBlank, Calculator, ChatCircle, CheckCircle, Clipboard, File, FolderSimple, Globe, HourglassMedium, NotePencil,
  PictureInPicture, Plus, Robot, ShareNetwork, Sparkle, SquaresFour, Stop, WifiSlash, X,
} from '@phosphor-icons/react'

import { searchItems, titleOf, whenCopied } from '../../shared/clipboard-model.mjs'
import { DEFAULT_SETTINGS, handOff, keywordAddress, readLine } from '../../shared/launcher-model.mjs'
import { rankApps } from '../../shared/quick-search-model.mjs'
import { applyAction } from '../assistant/actions.js'
import { ActionCards, UsedNotes, modelLabel } from '../assistant/LocalAssistant.jsx'
import { cleanError, setupLine, useAi } from '../assistant/useAi.js'
import { useAskHere } from '../assistant/useAskHere.js'
import { localDateKey } from '../daily-practice.js'
import { botTakers } from '../lib/bot-jobs.js'
import { findAll } from '../lib/find.js'
import { Markdown } from '../lib/markdown.jsx'
import { spaceFor } from '../lib/spaces.js'
import { inputActive } from '../lib/ui.js'
import { addNextStep } from '../next-steps.js'
import { linkMentions } from '../nodes-model.js'
import { captureThought, isActiveNote } from '../notes-model.js'

const KINDS = {
  note: [NotePencil, 'Note'],
  file: [File, 'On this Mac'],
  'mac-folder': [FolderSimple, 'On this Mac'],
  folder: [FolderSimple, 'Node'],
  room: [null, 'Room'],
  action: [null, 'Action'],
}
const ACTION_ICONS = {
  'act:new-note': Plus,
  'act:today': CalendarBlank,
  'act:new-folder': FolderSimple,
  'act:board': ShareNetwork,
  'act:focus': HourglassMedium,
  'act:offline': WifiSlash,
  'act:widget': SquaresFour,
}
const iconFor = (row) => KINDS[row.kind]?.[0] || ACTION_ICONS[row.key] || spaceFor(row.go[0])?.icon || Sparkle

/* The one line in the middle of the desk. Type, and a drawer folds open under it:
   Save as a sticky (always first, so Return never guesses), Ask the AI on this Mac,
   Add as a next step, then up to five matches (notes, files on this Mac, folders, rooms,
   actions). ⌘K and ⇧⌘N land here (`summon`). An answer streams into a card under the
   line and is kept as a chat.
   The line reports where it rests (`onLine`), so rooms open beside it; when a room
   covers it anyway, it rises to the top of the desk and stays above the rooms
   (`raised`), drawer and all. Its end holds the Offline switch (`offline`: main's
   { on, terminal }; `onOffline` flips it): while on, a calm line under it says so.
   It is also a launcher (Phase 13, Settings → Launcher): a sum answers in place (`2*49` shows = 98 in the line, ↓ then
   Return copies it), Nate's keywords open an app or a web search (`ss`, `g cats`), `v` lists what was copied, an app
   named as you type is one row, and `>` is for a bot (none can take a job yet, and it says so). "Save as a sticky"
   stays first: only the arrows ever move to a launcher row, so Return never guesses. `onNote` says one calm line. */
export function Line({
  workspace, commit, navigate, greeting, storage, visit = 0, summon = 0, paused = false, offline = null, onOffline,
  raised = false, onLine, onOpenNote, onSaved, onNote, stacks,
}) {
  const center = useRef(null)
  const greetingRef = useRef(null)
  const lineRef = useRef(null)
  const lastLine = useRef('')
  const box = useRef(null)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [found, setFound] = useState([])
  const { models, status: aiStatus, refresh: checkAi } = useAi()
  const notes = workspace.notes.filter(isActiveNote)
  const text = draft.trim()
  const isOffline = offline?.on === true

  /* Ask talks to the model chosen in Settings (the AI on this Mac unless a cloud one was picked). */
  const ai = models === null ? { state: 'checking', label: '' } : models.length ? { state: 'ready', label: modelLabel(models[0]), id: models[0].id } : { state: 'none', label: '' }
  const { answer, setAnswer, ask: askHere, stop, close } = useAskHere({ workspace, commit, modelId: ai.id, context: { stacks } })

  /* The launcher (Settings → Launcher): a sum, Nate's keywords, what he copied, an app by name, a job for a bot. In the
     line only `v` and his own keywords are special: a sentence that starts with "a" or "f" is only a sentence. */
  const bridge = window.osatSearch
  const [launch, setLaunch] = useState(DEFAULT_SETTINGS)
  const [copies, setCopies] = useState([])
  const [apps, setApps] = useState([])
  const line = useMemo(() => readLine(draft, launch), [draft, launch])
  const clipboardScope = line.scope === 'clipboard'
  const words = clipboardScope ? line.words : text
  useEffect(() => {
    const take = (value) => { if (value?.sources) setLaunch(value) }
    bridge?.settings().then(take, () => {})
    return bridge?.onSettings(take)
  }, [bridge])
  useEffect(() => {
    if (!open || !clipboardScope || !bridge) { setCopies([]); return undefined }
    let current = true
    bridge.clipboard().then((list) => { if (current) setCopies(Array.isArray(list?.items) ? list.items : []) }, () => {})
    return () => { current = false }
  }, [open, clipboardScope, bridge])
  useEffect(() => {
    if (!open || !bridge || apps.length || text.length < 2 || !launch.sources.apps.on) return
    bridge.apps().then((list) => setApps(Array.isArray(list) ? list : []), () => {})
  }, [open, bridge, apps.length, text.length, launch.sources.apps.on])

  const matches = useMemo(() => (open && !clipboardScope ? findAll(workspace, words, { files: text ? found : [] }) : []), [open, workspace, words, text, found, clipboardScope])
  const say = (message) => onNote?.(message)
  const attempt = (work) => Promise.resolve().then(work).catch((error) => say(cleanError(error)))
  const copyText = (value) => (bridge?.copyText ? bridge.copyText(value) : navigator.clipboard?.writeText(value))
  // Right under Save, so only the arrows reach them: the answer to a sum, the app or search a keyword names, a bot job.
  const launcherRows = [
    ...(line.sum ? [{ key: 'sum', label: `= ${line.sum.text}`, hint: 'Copy the answer', icon: Calculator, run: () => { reset(); attempt(async () => { await copyText(line.sum.plain); say(`Copied ${line.sum.text}`) }) } }] : []),
    ...(line.keyword && bridge ? [line.keyword.keyword.app
      ? { key: `kw:${line.keyword.keyword.id}`, label: `Open ${line.keyword.keyword.label}`, hint: line.keyword.keyword.keyword, icon: AppWindow, run: () => { reset(); attempt(() => bridge.openAppNamed(line.keyword.keyword.app)) } }
      : { key: `kw:${line.keyword.keyword.id}`, label: line.keyword.keyword.url.includes('{query}') ? `Search ${line.keyword.keyword.label} for “${line.keyword.query}”` : `Open ${line.keyword.keyword.label}`, tag: 'Web', icon: Globe, run: () => { reset(); attempt(() => bridge.openLink(keywordAddress(line.keyword.keyword, line.keyword.query))) } }] : []),
    ...(line.bot ? [{ key: 'bot', label: 'Hand this to a bot', hint: botTakers().length ? line.bot.job : 'No bot takes jobs yet', tag: 'Bots', icon: Robot, run: () => { const sent = handOff(line.bot.job, botTakers()); if (sent.ok) { sent.run(); reset() } else say(sent.message) } }] : []),
  ]
  const named = open && bridge && !clipboardScope && text.length >= 2
    ? rankApps(apps, text).filter((app) => app.name.toLowerCase().startsWith(text.toLowerCase())).slice(0, 2)
    : []
  const launchedRows = [
    ...(clipboardScope ? searchItems(copies, line.words).slice(0, 5).map((item) => ({ key: `clip:${item.id}`, label: titleOf(item), hint: [item.app, whenCopied(item.at)].filter(Boolean).join(' · '), tag: 'Clipboard', icon: Clipboard, run: () => { reset(); attempt(async () => { await bridge.copyClip(item.id); say('Copied. Press ⌘V in the app you want it in.') }) } })) : []),
    ...named.map((app) => ({ key: `app:${app.path}`, label: `Open ${app.name}`, tag: 'App', icon: AppWindow, run: () => { reset(); attempt(() => bridge.openApp(app.path)) } })),
  ]
  const rows = [
    ...(text ? [
      { key: 'save', label: 'Save as a sticky', keys: '↵', icon: NotePencil, run: save },
      ...launcherRows,
      ai.state === 'none'
        ? { key: 'ask', label: 'Set up the AI', hint: setupLine(aiStatus) || 'It runs on this Mac, nothing leaves it', keys: '⌘↵', icon: Sparkle, run: () => { setOpen(false); navigate('Settings', { section: 'ai' }) } }
        : { key: 'ask', label: 'Ask the AI on this Mac', hint: ai.state === 'ready' ? ai.label : 'Looking for it…', keys: '⌘↵', icon: Sparkle, run: ask },
      { key: 'next', label: 'Add as a next step', keys: '⌥↵', icon: CheckCircle, run: addStep },
    ] : []),
    ...launchedRows,
    ...matches.map((row) => ({ ...row, icon: iconFor(row), tag: KINDS[row.kind]?.[1], run: () => { reset(); navigate(...row.go) } })),
  ]
  // The hairline sits between what Return, ⌘↵ and ⌥↵ do (with the launcher's rows after Save) and what was found.
  const firstMatch = text ? 3 + launcherRows.length : -1
  const active = Math.min(cursor, rows.length - 1)
  const showing = open && rows.length > 0

  /* Where the line rests (offsets ignore the rise, which is only a translate), and how far
     it has to travel to reach the top of the desk. */
  useEffect(() => {
    const middle = center.current
    const form = lineRef.current
    if (!middle || !form) return undefined
    const measure = () => {
      const box = middle.getBoundingClientRect()
      const greeting = greetingRef.current
      const top = box.top + (greeting ? greeting.offsetTop : form.offsetTop)
      const rest = {
        left: Math.round(box.left + form.offsetLeft),
        right: Math.round(box.left + form.offsetLeft + form.offsetWidth),
        top: Math.round(top),
        bottom: Math.round(box.top + form.offsetTop + form.offsetHeight),
      }
      middle.style.setProperty('--rise', `${form.offsetTop}px`)
      // The room under the line down to the dock, so a long drawer scrolls rather than slip under it.
      const dock = middle.parentElement.querySelector(':scope > .dock')
      // Only a dock at the foot of the desk takes room from the drawer; on a side edge it has the whole height.
      const floor = dock && dock.dataset.side !== 'left' && dock.dataset.side !== 'right' ? dock.offsetTop - middle.offsetTop : middle.clientHeight
      middle.style.setProperty('--below', `${floor - form.offsetTop - form.firstElementChild.offsetHeight}px`)
      const key = JSON.stringify(rest)
      if (key === lastLine.current) return
      lastLine.current = key
      onLine?.(rest)
    }
    // An answer lifts the line (a grid transition): measure again once it settles.
    const observer = new ResizeObserver(measure)
    observer.observe(middle)
    observer.observe(form)
    middle.addEventListener('transitionend', measure)
    return () => { observer.disconnect(); middle.removeEventListener('transitionend', measure) }
  }, [onLine])

  /* Each time the desk is shown the line is ready to type into. */
  useEffect(() => {
    if (visit) box.current?.focus()
  }, [visit])

  const live = useRef(null)
  live.current = { open, cursor: active, answer, paused }

  /* ⌘K, ⇧⌘N and the menu's Find land here: the words are picked, the drawer is open.
     During Focus it waits until the Focus screen has stepped aside. A layout effect, so
     the drawer is open by the time the line has the keyboard: an Esc right after ⌘K
     closes the drawer, never slips past it and closes the room behind. */
  const summoned = useRef(0)
  useLayoutEffect(() => {
    if (!summon || paused || summoned.current === summon) return
    summoned.current = summon
    box.current?.focus()
    box.current?.select()
    setCursor(0)
    setOpen(true)
  }, [summon, paused])

  // The picked row stays in sight when the drawer has to scroll.
  useEffect(() => {
    const row = showing && document.getElementById(`home-row-${active}`)
    if (!row) return
    const drawer = row.parentElement
    if (row.offsetTop < drawer.scrollTop) drawer.scrollTop = active ? row.offsetTop : 0
    else if (row.offsetTop + row.offsetHeight > drawer.scrollTop + drawer.clientHeight) drawer.scrollTop = row.offsetTop + row.offsetHeight - drawer.clientHeight
  }, [showing, active])

  // A model started since the desk opened (LM Studio, a finished download) counts.
  useEffect(() => {
    if (open && ai.state !== 'ready') checkAi()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Files on this Mac from Spotlight (the Mac app only): plain words find names and what is
     inside files, and "pdf last week" means just that (shared/file-query.mjs). */
  useEffect(() => {
    setFound([]) // what Spotlight found for the last words never answers these
    const api = window.nateOSFiles
    const q = words.toLowerCase()
    if (!open || !api?.search || q.length < 2 || /(^|\s)#\S/.test(q) || clipboardScope) return undefined
    let current = true
    const timer = window.setTimeout(() => api.search(q).then((items) => { if (current) setFound(Array.isArray(items) ? items.slice(0, 8) : []) }, () => {}), 180)
    return () => { current = false; window.clearTimeout(timer) }
  }, [words, open, clipboardScope])

  /* Esc, one step at a time: a picked row goes back to the first, the drawer closes (the
     words stay), the answer is put away. Then the desk takes over (the top pop-out, then
     the desk itself). Capture phase, so it runs before the desk's own Esc. */
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.documentElement.dataset.menu === 'open') return
      const { open: drawer, cursor: row, answer: shown, paused: resting } = live.current
      if (resting || center.current?.closest('[inert]') || event.target.closest?.('.popout, [role="dialog"]')) return
      if (drawer && row > 0) setCursor(0)
      else if (drawer) setOpen(false)
      else if (shown) closeAnswer()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* Type anywhere on the desk and the words land in the line. */
  useEffect(() => {
    const onKey = (event) => {
      if (live.current.paused || document.activeElement?.closest?.('.popout')) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || inputActive()) return
      if (box.current?.closest('[inert]')) return
      if (event.key === ' ' && document.activeElement && document.activeElement !== document.body) return
      event.preventDefault()
      box.current?.focus()
      setDraft((value) => value + event.key)
      setCursor(0)
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function reset() {
    setDraft('')
    setOpen(false)
    setCursor(0)
    if (box.current) box.current.style.height = ''
  }

  function save() {
    if (!text) return
    let note
    commit((state) => {
      // A sticky in Unsorted; one written offline says so.
      const result = captureThought(state, text.slice(0, 8000), isOffline ? 'Offline' : 'Home')
      note = result.note
      return note ? linkMentions(result.state, note.id) : result.state
    })
    reset()
    if (note) onSaved?.(note.id)
    box.current?.focus()
  }

  function addStep() {
    if (!text) return
    commit((state) => addNextStep(state, text.replace(/\s*\n\s*/g, ' '), localDateKey()))
    reset()
    box.current?.focus()
  }

  function ask() {
    if (!text) return
    if (ai.state !== 'ready') { checkAi(); return }
    askHere(text.slice(0, 8000))
    reset()
  }

  function closeAnswer() {
    close()
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

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (event.metaKey || event.ctrlKey) rows.find((row) => row.key === 'ask')?.run()
      else if (event.altKey) addStep()
      else if (showing) rows[active].run()
      else save()
      return
    }
    // ↓ and ↑ walk the rows; in a longer thought they move the caret until its last line.
    // With ⌘ or ⌥ they stay text keys.
    const el = event.currentTarget
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
    if (event.key === 'ArrowDown' && plain && (active > 0 || !el.value.slice(el.selectionEnd).includes('\n'))) {
      event.preventDefault()
      if (!showing) { setCursor(0); setOpen(true) } else setCursor(Math.min(active + 1, rows.length - 1))
    } else if (event.key === 'ArrowUp' && plain && showing && active > 0) {
      event.preventDefault()
      setCursor(active - 1)
    }
  }

  return (
    <div ref={center} className="home-center" data-active={open || answer ? '' : undefined}>
      <h1 ref={greetingRef} className="home-greeting" aria-hidden={raised || undefined}>{greeting}</h1>

      <form
        ref={lineRef}
        className="home-composer-wrap"
        onSubmit={(event) => { event.preventDefault(); save() }}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
      >
        <div className="home-line">
          <div className={`glass home-composer ${text ? 'has-text' : ''}`}>
            <label className="visually-hidden" htmlFor="home-line">Write it down, find it, or ask</label>
            <textarea
              id="home-line"
              ref={box}
              rows={2}
              value={draft}
              maxLength={8000}
              placeholder="Write it down, find it, or ask…"
              role="combobox"
              aria-expanded={showing}
              aria-controls={showing ? 'home-drawer' : undefined}
              aria-autocomplete="list"
              aria-activedescendant={showing ? `home-row-${active}` : undefined}
              onChange={(event) => {
                setDraft(event.target.value)
                setCursor(0)
                setOpen(Boolean(event.target.value.trim()))
                const el = event.target
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 180)}px`
              }}
              onKeyDown={onKeyDown}
            />
            {line.sum && <span className="home-sum" aria-live="polite">= {line.sum.text}</span>}
            {onOffline && (
              <button type="button" className="home-offline" aria-pressed={isOffline} aria-label="Offline" title={isOffline ? 'Go back online  ⇧⌘U' : 'Go offline: nothing leaves OSAT  ⇧⌘U'} onClick={onOffline}>
                <WifiSlash weight={isOffline ? 'bold' : 'regular'} />
              </button>
            )}
            <button type="submit" className="home-send" aria-label="Save as a sticky" title="Save as a sticky ↵ · Shift-Return for a new line" disabled={!text}>
              <ArrowUp weight="bold" />
            </button>
            {storage?.status === 'error' && (
              <p className="home-chip" role="alert">
                <i />
                <span>This didn’t save just now. What you write stays here.</span>
                <button type="button" onClick={() => navigate('Settings', { section: 'data' })}>See why</button>
              </p>
            )}
          </div>

          {showing && (
            <div id="home-drawer" className="home-drawer" role="listbox" aria-label={text ? 'What to do with it' : 'Jump to'}>
              {!text && <p className="home-drawer-head" aria-hidden="true">Jump to</p>}
              {rows.map((row, index) => (
                <div
                  key={row.key}
                  id={`home-row-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`home-row ${text && index === firstMatch ? 'is-first-match' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={row.run}
                >
                  <row.icon weight={index === active ? 'fill' : 'regular'} />
                  <span className="home-row-label">{row.label}{row.hint && <> <em>{row.hint}</em></>}</span>
                  {row.keys ? <kbd>{row.keys}</kbd> : row.tag && <small>{row.tag}</small>}
                </div>
              ))}
            </div>
          )}
        </div>
        {isOffline && (
          <p className="home-offline-note" role="status">
            <WifiSlash weight="bold" aria-hidden="true" /> {window.osatUnder ? 'Offline · nothing leaves OSAT' : 'Offline · the look only, in this preview'}
            {offline.terminal && '. A terminal you started keeps running.'}
          </p>
        )}
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
          <UsedNotes ids={answer.noteIds} notes={notes} onOpen={(noteId) => onOpenNote?.(noteId)} />
          <ActionCards
            actions={answer.actions}
            onAdd={(action) => { commit((state) => applyAction(state, action, localDateKey())); setAnswer((value) => ({ ...value, actions: value.actions.filter((item) => item.id !== action.id) })) }}
            onDiscard={(action) => setAnswer((value) => ({ ...value, actions: value.actions.filter((item) => item.id !== action.id) }))}
          />
          <footer>
            {answer.busy
              ? <button type="button" onClick={stop}><Stop weight="fill" /> Stop</button>
              : <button type="button" onClick={() => { const chatId = answer.chatId; setAnswer(null); navigate('Assistant', { chatId }) }}><ChatCircle /> Keep talking</button>}
            {!answer.busy && window.osatChat && (
              <button type="button" title="Keep talking in a small window over your other apps" onClick={() => { const chatId = answer.chatId; setAnswer(null); window.osatChat.show({ chatId }) }}><PictureInPicture /> Pop out</button>
            )}
            {!answer.busy && answer.text.trim() && (
              answer.savedId
                ? <span className="home-answer-saved"><NotePencil /> Saved to Unsorted</span>
                : <button type="button" onClick={saveAnswer}><NotePencil /> Save as a note</button>
            )}
          </footer>
        </section>
      )}
    </div>
  )
}
