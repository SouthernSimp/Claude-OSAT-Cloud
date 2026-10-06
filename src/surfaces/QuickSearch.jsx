import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretLeft, MagnifyingGlass, NotePencil, PushPin, Sparkle, X } from '@phosphor-icons/react'

import { findCaptures, recentRows, wantsRecent } from '../../shared/capture-model.mjs'
import { offerFor } from '../../shared/clipboard-offer.mjs'
import { KIND_FILTERS } from '../../shared/clipboard-model.mjs'
import { DEFAULT_SETTINGS } from '../../shared/launcher-model.mjs'
import { FILE_FILTERS, actionsFor, buildRows, rankCommands, readTyped, scopesOn } from '../../shared/quick-search-model.mjs'
import { LocalAssistant, modelLabel } from '../assistant/LocalAssistant.jsx'
import { cleanError, useAi } from '../assistant/useAi.js'
import { findAll } from '../lib/find.js'
import { addSticky, linkMentions } from '../nodes-model.js'
import { captureThought, folderPath } from '../notes-model.js'
import { AppIcon, RowIcon } from '../search/icons.jsx'
import { Preview } from '../search/Preview.jsx'
import { useSources } from '../search/useSources.js'
import { useWorkspace } from '../store/useWorkspace.js'
import { canAsk } from '../views/Files.jsx'

/* The quick bar (Phase 13; one bar since 13c, when it took over the quick chat): a small bar over every app (⌘⇧Space)
   that opens into the full view as you type. Results on the left, a big preview on the right, the details under it.
   Return does the obvious thing (Open; for a copy, Paste into the app you were in); ⌘K lists every other action;
   ⌘Return asks the AI about what is typed (the answer streams in this window and is kept as a chat: Ask, the same
   chats as the Ask room); ⌥Return saves it straight to Unsorted as a sticky. Words are commands too ("clipboard",
   "sticky", "ask", "left half", a room, a Settings page): lib/find.js is the one list, shared with the desk's ⌘K.
   Esc backs out one step: the actions, a sticky or a question being written, the words, the tab, Ask, then the bar
   itself. Tab moves between Everything, Files, Clipboard, Apps and Notes; a keyword typed first does the same ("v" is
   the clipboard). ⌥⇧Space opens it on Ask. Drag it by its edges; it opens where it was left.
   The panel asks main for files, copies and apps (`window.osatSearch`); notes, nodes and commands it finds itself. */

const comboOf = (event) => {
  const key = { Enter: '↵', Backspace: '⌫', Delete: '⌫' }[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  return `${event.altKey ? '⌥' : ''}${event.shiftKey ? '⇧' : ''}${event.metaKey || event.ctrlKey ? '⌘' : ''}${key}`
}

export function QuickSearchSurface() {
  const bridge = window.osatSearch
  const { workspace, commit, ready } = useWorkspace()
  const input = useRef(null)
  const live = useRef(null)
  const hideTimer = useRef(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [text, setText] = useState('')
  const [scope, setScope] = useState('all')
  const [fileFilter, setFileFilter] = useState('all')
  const [clipFilter, setClipFilter] = useState('all')
  const [cursor, setCursor] = useState(0)
  const [menu, setMenu] = useState(null)
  const [picker, setPicker] = useState(null)
  const [note, setNote] = useState('')
  const [toast, setToast] = useState(null)
  const [gone, setGone] = useState(() => new Set())
  const [visit, setVisit] = useState(0)
  const [opened, setOpened] = useState('bar')
  // A sticky or a question being written in the bar ('sticky' | 'ask'), and Ask: on, kept once opened (so the chat
  // you were in is there next time), and what to hand it ({ chatId } or { prompt, send }).
  const [mode, setMode] = useState(null)
  const [chatOn, setChatOn] = useState(false)
  const [chatKept, setChatKept] = useState(false)
  const [handoff, setHandoff] = useState(null)
  const [offline, setOffline] = useState(false)
  const { models } = useAi()
  const ai = models === null ? { state: 'checking' } : models.length ? { state: 'ready', label: modelLabel(models[0]), offline } : { state: offline ? 'waits' : 'none' }

  const read = useMemo(() => readTyped(text, settings, scope), [text, settings, scope])
  const { found, looking, reloadClipboard } = useSources({ bridge, read, settings, fileFilter, visit })
  // Commands always; notes and nodes when that source is on.
  const wantsFind = Boolean(workspace) && (read.scope === 'notes' || (read.scope === 'all' && read.query.length > 0))
  const looked = useMemo(() => (wantsFind ? findAll(workspace, read.query, { limit: 30, bar: true }) : []), [wantsFind, workspace, read.query])
  const commands = useMemo(() => (read.scope === 'all' ? rankCommands(looked.filter((item) => item.kind === 'room' || item.kind === 'action'), read.query) : []), [looked, read.scope, read.query])
  const notes = useMemo(() => (!settings.sources.notes.on ? [] : read.scope === 'notes' ? looked : looked.filter((item) => item.kind === 'note' || item.kind === 'folder').slice(0, 6)), [looked, read.scope, settings])
  // Screenshots and recording: what this Mac can do (CleanShot X, or the Mac's own), and CleanShot's recent captures.
  const [shooting, setShooting] = useState(null)
  const [shotList, setShotList] = useState([])
  useEffect(() => { bridge?.captureStatus?.().then(setShooting, () => {}) }, [bridge, visit])
  const askedRecent = Boolean(settings.captures?.recent && shooting?.cleanshot) && read.scope === 'all' && wantsRecent(read.query)
  useEffect(() => { if (askedRecent) bridge.captureRecent().then((list) => setShotList(Array.isArray(list) ? list : []), () => {}) }, [bridge, askedRecent, visit])
  const captures = useMemo(() => (shooting && read.scope === 'all' ? findCaptures(read.query, shooting.list || [], { cleanshot: shooting.cleanshot }) : []), [shooting, read.scope, read.query])
  const shots = useMemo(() => (askedRecent ? recentRows(shotList) : []), [askedRecent, shotList])
  const rows = useMemo(
    () => buildRows(read, { ...found, commands, notes, captures, shots }, settings, { fileFilter, clipFilter, ai }).filter((row) => !gone.has(row.key)),
    [read, found, commands, notes, captures, shots, settings, fileFilter, clipFilter, gone, ai.state, ai.label, ai.offline], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const active = Math.min(cursor, Math.max(0, rows.length - 1))
  const row = rows[active] || null
  // "Add to Jordan": a copied email or phone number that belongs to a node that already exists.
  const offer = useMemo(() => (row && ['text', 'email', 'phone'].includes(row.kind) && settings.clipboard.offers !== false ? offerFor(row.data, workspace || {}) : null), [row, settings, workspace])
  const actions = useMemo(() => actionsFor(row, { offer, canAsk: row?.kind === 'file' && canAsk({ kind: 'file', name: row.title }) }), [row, offer])
  const full = !mode && (opened === 'full' || text.trim().length > 0 || scope !== 'all' || Boolean(picker))
  const size = chatOn ? 'chat' : full ? 'full' : 'bar'
  const tabs = scopesOn(settings)

  useEffect(() => { bridge?.mode(size) }, [bridge, size])
  // Offline, Ask says whether it waits (a cloud model does; the AI on this Mac still answers).
  useEffect(() => {
    const api = window.osatUnder
    if (!api) return undefined
    api.status().then((status) => setOffline(status?.on === true), () => {})
    return api.onChange((status) => setOffline(status?.on === true))
  }, [])
  useEffect(() => { document.getElementById(`qs-row-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active, rows.length])

  /* Settings: what is on, the keywords, the pins. Main tells every window when they change. */
  useEffect(() => {
    const take = (value) => { if (value?.sources) setSettings(value) }
    bridge?.settings().then(take, () => {})
    return bridge?.onSettings(take)
  }, [bridge])

  const said = useCallback((message, ms = 2600) => {
    setNote(message)
    if (ms) window.setTimeout(() => setNote((now) => (now === message ? '' : now)), ms)
  }, [])
  // A copy or a recent capture drags out into other apps, from its row or its preview (main starts the Mac's drag).
  const dragOut = (item) => (item?.source === 'clipboard' && bridge?.dragClip
    ? (event) => { event.preventDefault(); bridge.dragClip(item.data.id).catch((error) => said(cleanError(error), 4000)) }
    : item?.kind === 'shot' ? (event) => { event.preventDefault(); bridge.captureDrag(item.data.id).catch(() => {}) } : undefined)
  const cancelHide = useCallback(() => window.clearTimeout(hideTimer.current), [])
  const away = useCallback(() => { cancelHide(); bridge?.hide() }, [bridge, cancelHide])
  const hideLater = useCallback((ms) => { cancelHide(); hideTimer.current = window.setTimeout(away, ms) }, [away, cancelHide])
  // A copied-result timeout must not close the panel while someone continues using it.
  useEffect(() => {
    window.addEventListener('keydown', cancelHide, true)
    window.addEventListener('pointerdown', cancelHide, true)
    const stop = bridge?.onShown(cancelHide)
    return () => { cancelHide(); stop?.(); window.removeEventListener('keydown', cancelHide, true); window.removeEventListener('pointerdown', cancelHide, true) }
  }, [bridge, cancelHide])
  const toOSAT = useCallback((view, detail) => { bridge?.openInOSAT(view, detail) }, [bridge])

  /* Ask, in this window: `detail` is { chatId } (popped out of the desk), { prompt, send } (⌘Return) or nothing (the
     chat you were in). */
  const openChat = useCallback((detail = null) => {
    setChatOn(true)
    setChatKept(true)
    setMode(null)
    if (typeof detail?.chatId === 'string' || typeof detail?.prompt === 'string') setHandoff({ ...detail, at: Date.now() })
    requestAnimationFrame(() => document.querySelector('.qs-chat .composer textarea')?.focus())
  }, [])
  const leaveChat = useCallback(() => {
    setChatOn(false)
    setMode(null)
    requestAnimationFrame(() => input.current?.focus())
  }, [])

  /* Shown again: a clean bar (or the tab the Hyper key names, a sticky to write, or Ask), ready to type into. */
  useEffect(() => bridge?.onShown(({ scope: tab = 'all', mode: shape = 'bar', text: waiting = '', view = 'search', chat = null } = {}) => {
    setText(waiting); setScope(tab); setFileFilter('all'); setClipFilter('all'); setCursor(0); setMenu(null); setPicker(null)
    setNote(''); setToast(null); setGone(new Set()); setOpened(shape === 'full' ? 'full' : 'bar'); setVisit((value) => value + 1)
    if (view === 'chat') { openChat(chat); return }
    setChatOn(false)
    setMode(view === 'sticky' ? 'sticky' : null)
    requestAnimationFrame(() => input.current?.focus())
  }), [bridge, openChat])
  useEffect(() => { bridge?.ready() }, [bridge])

  /* ⌥Return: the words go straight to Unsorted as a sticky, as on the desk's line. Nothing typed: write one. */
  const saveSticky = useCallback((words) => {
    const value = String(words || '').trim()
    if (!value) { setMode('sticky'); requestAnimationFrame(() => input.current?.focus()); return }
    if (!workspace) { said('Opening your notes… try again in a moment.'); return }
    let made = null
    commit((state) => {
      const result = captureThought(state, value.slice(0, 8000), 'Quick bar')
      made = result.note
      return made ? linkMentions(result.state, made.id) : result.state
    })
    setText(''); setMode(null); setCursor(0)
    said(made ? 'Saved to Unsorted' : 'Nothing to save', 1400)
    if (made) hideLater(1100)
  }, [workspace, commit, said, hideLater])

  /* ⌘Return: Ask, here; the answer streams in this window and is kept as a chat. Nothing typed opens Ask. */
  const askAi = useCallback((words) => {
    const value = String(words || '').trim()
    setText(''); setCursor(0)
    openChat(value ? { prompt: value.slice(0, 8000), send: true } : null)
  }, [openChat])

  /* Actions. Each says what happened in one calm line; deleting offers Undo. */
  const addTo = useCallback(async (target, folderId) => {
    const d = target.data
    const words = target.source === 'clipboard' ? (await bridge?.clipboardText(d.id).catch(() => null)) ?? d.text : `${target.title}\n${d.where || ''}`.trim()
    let made = null
    commit((state) => { const result = addSticky(state, words, folderId, { source: 'Quick bar' }); made = result.note; return result.state })
    const name = workspace.folders.find((folder) => folder.id === folderId)?.name
    said(made ? `Added to ${name}` : 'Nothing to add', 900)
    if (made) hideLater(900)
    setPicker(null)
  }, [bridge, commit, workspace, said, away, hideLater])

  const run = useCallback(async (id, target) => {
    if (!target) return
    const d = target.data
    const undoable = (message, undo) => setToast({ message, undo, at: Date.now() })
    try {
      switch (id) {
        case 'emoji': { const result = await bridge.emoji(); if (!result.ok) said('The character picker is available on the Mac.'); break }
        case 'open':
          if (target.kind === 'folder') toOSAT('Files', { rootId: d.rootId, relative: d.relative })
          else { await bridge.openFile(d.rootId, d.relative); away() }
          break
        case 'reveal': await bridge.revealFile(d.rootId, d.relative); away(); break
        case 'copy-path': await bridge.copyPath(d.rootId, d.relative); said('Copied the path'); break
        case 'ask': toOSAT('Assistant', { file: { rootId: d.rootId, relative: d.relative, name: d.name } }); break
        case 'add': setMenu(null); setPicker({ row: target }); break
        case 'offer': if (live.current.offer) await addTo(target, live.current.offer.folderId); break
        case 'pin':
          if (target.source === 'files') await bridge.pinFile({ rootId: d.rootId, relative: d.relative, kind: target.kind }, !target.pinned)
          else { await bridge.pinClip(d.id, !d.pinned); reloadClipboard() }
          break
        case 'delete':
          if (target.source === 'files') {
            const result = await bridge.trashFile(d.rootId, d.relative)
            setGone((set) => new Set(set).add(target.key))
            undoable('Moved to the Bin', async () => { await bridge.undoFile(result.undo); setGone((set) => { const next = new Set(set); next.delete(target.key); return next }) })
          } else {
            const token = await bridge.forgetClip(d.id)
            reloadClipboard()
            undoable('Deleted the copy', async () => { await bridge.undoClip(token); reloadClipboard() })
          }
          break
        case 'paste': {
          const result = await bridge.pasteClip(d.id)
          if (result.reason === 'access') {
            // One press asks macOS (which opens its own prompt); a build that macOS has forgotten needs OSAT removed and added again.
            setToast({ message: 'Copied. Press ⌘V to paste. To paste for you, OSAT needs Accessibility.', label: 'Allow…', undo: () => bridge.askAccess().catch(() => {}), at: Date.now() })
            hideLater(9000)
          } else if (!result.pasted) {
            said('Copied. Press ⌘V to paste.', 0)
            hideLater(2400)
          }
          break
        }
        case 'copy': await bridge.copyClip(d.id); said('Copied'); hideLater(500); break
        case 'copy-text': await bridge.copyText(d.plain); said('Copied the answer'); hideLater(500); break
        case 'paste-text': {
          const result = await bridge.pasteText(d.plain)
          if (!result.pasted) { said('Copied. Press ⌘V to paste.', 0); hideLater(2000) }
          break
        }
        case 'open-link': await bridge.openLink(target.kind === 'link' ? (await bridge.clipboardText(d.id)) || d.text : d.url); away(); break
        case 'open-app': await bridge.openApp(d.path); away(); break
        case 'reveal-app': await bridge.revealApp(d.path); away(); break
        case 'open-app-named': await bridge.openAppNamed(d.app); away(); break
        case 'snap': {
          const result = await bridge.snap(d.layout)
          if (!result.ok && result.reason === 'access') { said('To move windows, OSAT needs to be allowed in Accessibility. Settings → Launcher shows how.', 0); hideLater(3400) }
          else if (!result.ok && result.reason === 'mac') { said('Moving windows works in the Mac app.') }
          break
        }
        case 'sticky': saveSticky(d.text); break
        case 'ask-ai': askAi(d.text); break
        case 'go':
          // The bar's own commands happen right here; everything else opens on the desk.
          if (target.key === 'act:sticky') { setText(''); setMode('sticky') }
          else if (target.key === 'act:ask') { setText(''); setMode('ask') }
          else if (target.key === 'act:clipboard') { setText(''); setScope('clipboard'); setCursor(0) }
          else toOSAT(...d.go)
          break
        case 'capture': {
          const result = await bridge.capture(d.capture)
          if (!result.ok && result.reason === 'cleanshot') said(`${target.title} needs CleanShot X.`)
          else if (!result.ok && result.reason === 'mac') said('Screenshots work in the Mac app.')
          break
        }
        case 'shot-open': await bridge.captureOpen(d.id); away(); break
        case 'shot-reveal': await bridge.captureReveal(d.id); away(); break
        case 'shot-copy': await bridge.captureCopy(d.id); said('Copied'); hideLater(500); break
        default: break
      }
    } catch (error) {
      said(cleanError(error), 4000)
    }
  }, [bridge, said, away, hideLater, toOSAT, reloadClipboard, addTo, saveSticky, askAi])

  /* The keys. One listener that reads the latest state, so nothing is stale. */
  live.current = { rows, active, row, actions, menu, picker, text, scope, tabs, toast, full, offer, mode, chatOn }

  /* Esc backs out one step at a time. In Ask the chat has it first (a menu, the list of chats), then the bar does. */
  const back = useCallback(() => {
    const now = live.current
    if (now.chatOn) {
      const target = document.activeElement || document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    } else if (now.picker) setPicker(null)
    else if (now.menu) setMenu(null)
    else if (now.mode) setMode(null)
    else if (now.text) { setText(''); setCursor(0) }
    else if (now.scope !== 'all') { setScope('all'); setCursor(0) }
    else away()
  }, [away])
  useEffect(() => bridge?.onEscape(back), [bridge, back])
  // An Esc nothing in the chat wanted comes back to the bar.
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented && live.current.chatOn) { event.preventDefault(); leaveChat() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leaveChat])

  useEffect(() => {
    const onKey = (event) => {
      if (event.isComposing) return
      const now = live.current
      if (now.chatOn) return
      const cmd = event.metaKey || event.ctrlKey
      if (event.key === 'Escape') { event.preventDefault(); back(); return }
      if (now.picker) return
      // ⌘Return asks, ⌥Return saves a sticky, whatever row is picked.
      if (event.key === 'Enter' && cmd && !event.altKey && !event.shiftKey) { event.preventDefault(); askAi(now.text); return }
      if (event.key === 'Enter' && event.altKey && !cmd) { event.preventDefault(); saveSticky(now.text); return }
      if (now.mode) {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (now.mode === 'sticky') saveSticky(now.text); else askAi(now.text) }
        return
      }
      if (cmd && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (now.row) setMenu((value) => (value ? null : { at: 0 }))
        return
      }
      if (now.menu) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const size = now.actions.length
          setMenu({ at: (now.menu.at + (event.key === 'ArrowDown' ? 1 : size - 1)) % size })
        } else if (event.key === 'Enter') {
          event.preventDefault()
          const choice = now.actions[now.menu.at]
          setMenu(null)
          if (choice) run(choice.id, now.row)
        }
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor(Math.min(Math.max(now.active + (event.key === 'ArrowDown' ? 1 : -1), 0), Math.max(0, now.rows.length - 1)))
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const at = now.tabs.findIndex(([id]) => id === now.scope)
        setScope(now.tabs[(at + (event.shiftKey ? now.tabs.length - 1 : 1)) % now.tabs.length][0])
        setCursor(0)
        return
      }
      // Return, and the keys ⌘K lists next to each action.
      const combo = comboOf(event)
      const choice = now.actions.find((action) => action.keys === combo)
      if (choice && now.row) { event.preventDefault(); run(choice.id, now.row) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [back, run, askAi, saveSticky])

  // A toast lasts a while, then goes; its Undo goes with it.
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 9000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const empty = looking ? 'Looking…' : read.typed
    ? `Nothing found for “${read.typed}”.`
    : scope === 'clipboard' ? 'Nothing copied yet. Whatever you copy from now on shows up here, and stays on this Mac.'
      : scope === 'files' ? 'Files you use will show up here.' : 'Type to search.'

  const ModeIcon = mode === 'sticky' ? NotePencil : mode === 'ask' ? Sparkle : MagnifyingGlass
  const placeholder = mode === 'sticky' ? 'Write a sticky… Return saves it to Unsorted'
    : mode === 'ask' ? 'Ask the AI… Return asks'
      : scope === 'all' ? 'Search, ask, or write a sticky…' : `Search ${tabs.find(([id]) => id === scope)?.[1] || ''}…`

  return (
    <>
      {chatKept && workspace && (
        <section className="quick-chat qs-chat" hidden={!chatOn} aria-label="Ask">
          <header className="quick-bar">
            <button type="button" aria-label="Back to the bar" title="Back  esc" onClick={leaveChat}><CaretLeft weight="bold" /></button>
            <span><Sparkle weight="fill" /> Ask</span>
            <button type="button" aria-label="Put the bar away" title="Put it away" onClick={away}><X weight="bold" /></button>
          </header>
          <div className="quick-body">
            <LocalAssistant compact workspace={workspace} commit={commit} navigate={toOSAT} initialPrompt={handoff} />
          </div>
        </section>
      )}
    <main className="quick-search" hidden={chatOn} data-mode={full ? 'full' : 'bar'}>
      <header className="qs-bar">
        <ModeIcon weight="bold" aria-hidden="true" />
        <input
          ref={input}
          id="qs-input"
          className="qs-input"
          role="combobox"
          aria-expanded={full}
          aria-controls="qs-list"
          aria-activedescendant={row ? `qs-row-${active}` : undefined}
          aria-label="Search"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={text}
          maxLength={200}
          placeholder={placeholder}
          onChange={(event) => { setText(event.target.value); setCursor(0) }}
        />
        {!full && note ? <span className="qs-said" role="status">{note}</span>
          : mode ? <span className="qs-chip">{mode === 'sticky' ? 'Sticky' : 'Ask'}</span>
            : read.scope !== scope && <span className="qs-chip">{tabs.find(([id]) => id === read.scope)?.[1]}</span>}
      </header>

      {full && (
        <>
          <nav className="qs-tabs" aria-label="Where to look">
            <div role="tablist">
              {tabs.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={read.scope === id} onClick={() => { setScope(id); setCursor(0); input.current?.focus() }}>{label}</button>
              ))}
            </div>
            {read.scope === 'files' && (
              <div className="qs-filters" role="group" aria-label="Kind of file">
                {FILE_FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={fileFilter === id} onClick={() => { setFileFilter(id); setCursor(0); input.current?.focus() }}>{label}</button>)}
              </div>
            )}
            {read.scope === 'clipboard' && (
              <div className="qs-filters" role="group" aria-label="Kind of copy">
                {KIND_FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={clipFilter === id} onClick={() => { setClipFilter(id); setCursor(0); input.current?.focus() }}>{label}</button>)}
              </div>
            )}
          </nav>

          <div className="qs-body">
            {picker
              ? <NodePicker workspace={workspace} onPick={(folderId) => addTo(picker.row, folderId)} onClose={() => { setPicker(null); input.current?.focus() }} />
              : (
                <ul id="qs-list" className="qs-list" role="listbox" aria-label="Results">
                  {rows.length === 0 && <li className="qs-empty" role="presentation">{empty}</li>}
                  {rows.map((item, index) => (
                    <li key={item.key} role="presentation">
                      {(index === 0 || rows[index - 1].section !== item.section) && <p className="qs-head" aria-hidden="true">{item.section}</p>}
                      <div
                        id={`qs-row-${index}`}
                        className="qs-row"
                        role="option"
                        aria-selected={index === active}
                        data-kind={item.kind}
                        onClick={() => { setCursor(index); setMenu(null); input.current?.focus() }}
                        onDoubleClick={() => run(actionsFor(item)[0]?.id, item)}
                        // Right-click opens the same actions ⌘K lists.
                        onContextMenu={(event) => { event.preventDefault(); setCursor(index); setMenu({ at: 0 }); input.current?.focus() }}
                        draggable={Boolean(dragOut(item))}
                        onDragStart={dragOut(item)}
                      >
                        {item.kind === 'app' ? <AppIcon bridge={bridge} row={item} />
                          : item.kind === 'image' && item.data.thumb ? <img className="qs-row-icon qs-thumb" src={item.data.thumb} alt="" draggable={false} />
                            : <RowIcon row={item} />}
                        <span className="qs-row-text"><b>{item.title}</b><small>{item.subtitle}</small></span>
                        {(item.pinned || item.data?.pinned) && <PushPin weight="fill" className="qs-pin" aria-label="Pinned" />}
                        {index === active && <kbd>↵</kbd>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            <Preview row={picker ? picker.row : row} bridge={bridge} workspace={workspace} offer={picker ? null : offer} now={new Date()} onDragStart={picker ? undefined : dragOut(row)} />
            {menu && row && (
              <div className="qs-actions" role="menu" aria-label="Actions">
                {actions.map((action, index) => (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    className={`${index === menu.at ? 'is-on' : ''} ${action.danger ? 'is-danger' : ''}`}
                    onMouseEnter={() => setMenu({ at: index })}
                    onClick={() => { setMenu(null); run(action.id, row); input.current?.focus() }}
                  >
                    <span>{action.label}{action.hint && <em>{action.hint}</em>}</span>
                    {action.keys && <kbd>{action.keys}</kbd>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <footer className="qs-foot">
            {toast ? (
              <p role="status" className="qs-toast">{toast.message}<button type="button" onClick={() => { const undo = toast.undo; setToast(null); undo() }}>{toast.label || 'Undo'}</button></p>
            ) : note ? <p role="status">{note}</p> : (
              <p className="qs-keys">
                {actions[0] && !['sticky', 'ask-ai'].includes(actions[0].id) && <span><kbd>↵</kbd> {actions[0].label}</span>}
                <span><kbd>⌘↵</kbd> Ask</span>
                <span><kbd>⌥↵</kbd> Save as a sticky</span>
                {actions.length > 1 && <span><kbd>⌘K</kbd> More</span>}
                <span><kbd>esc</kbd> Back</span>
              </p>
            )}
            {!ready && <span className="qs-wait">Opening your notes…</span>}
          </footer>
        </>
      )}
    </main>
    </>
  )
}

/* "Add to a node…": type to narrow the nodes (and branches), Return picks the first. */
function NodePicker({ workspace, onPick, onClose }) {
  const [words, setWords] = useState('')
  const [at, setAt] = useState(0)
  const options = (workspace?.folders || [])
    .map((folder) => ({ id: folder.id, label: folderPath(workspace.folders, folder.id).join(' › ') }))
    .filter((option) => words.toLowerCase().split(/\s+/).every((word) => option.label.toLowerCase().includes(word)))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 30)
  const field = useRef(null)
  useEffect(() => { field.current?.focus() }, [])
  return (
    <div className="qs-picker">
      <input
        ref={field}
        aria-label="Add to which node?"
        placeholder="Add to which node?"
        value={words}
        onChange={(event) => { setWords(event.target.value); setAt(0) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setAt(Math.min(at + 1, options.length - 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setAt(Math.max(at - 1, 0)) }
          else if (event.key === 'Enter' && options[at]) { event.preventDefault(); event.stopPropagation(); onPick(options[at].id) }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        }}
      />
      <ul role="listbox" aria-label="Nodes">
        {options.length === 0 && <li className="qs-empty">{workspace?.folders?.length ? 'No node by that name.' : 'You have no nodes yet. Make one in the Sky.'}</li>}
        {options.map((option, index) => (
          <li key={option.id} role="option" aria-selected={index === at} className="qs-row" onClick={() => onPick(option.id)}>
            <span className="qs-row-text"><b>{option.label}</b></span>
          </li>
        ))}
      </ul>
    </div>
  )
}
