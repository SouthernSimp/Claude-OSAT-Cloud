import { useContext, useEffect, useState } from 'react'
import { AppWindow, CaretDown, CaretRight, Calculator, ClipboardText, Files, Link, NotePencil, SquaresFour, Target, X } from '@phosphor-icons/react'

import { SOURCES, holderOf } from '../../../shared/launcher-model.mjs'
import { LAYOUTS } from '../../../shared/window-layouts.mjs'
import { LauncherPage } from './launcher.jsx'
import { Choice, KeyRecorder, QueryContext, Switch, WordField } from './parts.jsx'

/* Settings → Shortcuts (Phase 13b): every word and every key, in one table, the way Raycast's Shortcuts tab does it:
   Name, Word, Key, On. Groups fold; a filter narrows to what has a key, a word, or is off. Nothing here is a second copy:
   a row changes the same launcher setting its own page does. A key someone already has is named, and stays with them. */

const ICONS = { files: Files, clipboard: ClipboardText, apps: AppWindow, notes: NotePencil, calc: Calculator, windows: SquaresFour }
const FILTERS = [['all', 'All'], ['key', 'Has a key'], ['word', 'Has a word'], ['off', 'Off']]
const passes = (filter, row) => filter === 'all' || (filter === 'key' && row.hotkey) || (filter === 'word' && row.word) || (filter === 'off' && row.on === false)

export function ShortcutsPage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app, each place, app and layout can have a word to type and a key to press.">
      {(launcher) => <Table launcher={launcher} />}
    </LauncherPage>
  )
}

function Table({ launcher }) {
  const { bridge, settings, status, save } = launcher
  const query = useContext(QueryContext)
  const [filter, setFilter] = useState('all')
  const [folded, setFolded] = useState(() => new Set(['windows']))
  const [installed, setInstalled] = useState([])
  const [pending, setPending] = useState(null)
  useEffect(() => { bridge.apps().then((list) => setInstalled(Array.isArray(list) ? list : []), () => {}) }, [bridge])
  const sends = settings.hyper.sends
  const failed = (id) => status?.keysFailed?.includes(id)
  const wordHolder = (id) => (word) => holderOf(settings, { word }, id)
  const keyHolder = (id) => (combo) => holderOf(settings, { key: combo }, id)
  const editLink = (id, patch) => save({ links: settings.links.map((link) => (link.id === id ? { ...link, ...patch } : link)) })
  const setApp = (name, patch) => { save({ apps: { [name]: patch } }); if (pending === name) setPending(null) }

  const places = SOURCES.map((source) => {
    const own = settings.sources[source.id]
    const has = source.letter !== null
    return {
      id: `source:${source.id}`, icon: ICONS[source.id], name: source.label, hint: source.blurb, word: own.keyword, hotkey: own.hotkey, on: own.on, canWord: has, canKey: has,
      setWord: (keyword) => save({ sources: { [source.id]: { keyword } } }),
      setKey: (hotkey) => save({ sources: { [source.id]: { hotkey } } }),
      setOn: (on) => save({ sources: { [source.id]: { on } } }),
    }
  })
  const appNames = [...Object.keys(settings.apps), ...(pending && !settings.apps[pending] ? [pending] : [])]
  const apps = appNames.map((name) => {
    const own = settings.apps[name] || {}
    return {
      id: `app:${name}`, icon: AppWindow, name, hint: 'Opens it', word: own.keyword || null, hotkey: own.hotkey || null, on: true,
      setWord: (keyword) => setApp(name, { keyword }),
      setKey: (hotkey) => setApp(name, { hotkey }),
      remove: () => { save({ apps: { [name]: null } }); if (pending === name) setPending(null) },
    }
  })
  const links = settings.links.map((link) => ({
    id: `link:${link.id}`, icon: Link, name: link.name, hint: link.url, word: link.keyword, hotkey: link.hotkey, on: link.on !== false,
    setWord: (keyword) => editLink(link.id, { keyword }),
    setKey: (hotkey) => editLink(link.id, { hotkey }),
    setOn: (on) => editLink(link.id, { on }),
  }))
  const layouts = LAYOUTS.map((layout) => ({
    id: `snap:${layout.id}`, icon: SquaresFour, name: layout.label, hint: layout.id === 'restore' ? 'Where the window was before OSAT moved it' : 'Moves the window you were in', word: null, hotkey: settings.windows.hotkeys[layout.id], on: settings.windows.on, canWord: false,
    setKey: (hotkey) => save({ windows: { hotkeys: { [layout.id]: hotkey } } }),
  }))
  const ring = [{
    id: 'ring', icon: Target, name: 'The ring', hint: 'Quick tools around your pointer', word: null, hotkey: settings.ring.hotkey, on: settings.ring.on, canWord: false,
    setKey: (hotkey) => save({ ring: { hotkey } }), setOn: (on) => save({ ring: { on } }),
  }]
  const groups = [
    { id: 'places', title: 'Places', rows: places },
    { id: 'apps', title: 'Apps', rows: apps, add: true },
    { id: 'links', title: 'Quick links', rows: links },
    { id: 'windows', title: 'Window layouts', rows: layouts, master: { label: 'Use keys to move the window I’m in, from any app', checked: settings.windows.on, onChange: (on) => save({ windows: { on } }) } },
    { id: 'ring', title: 'The ring', rows: ring },
  ]

  const looking = query.length > 0 || filter !== 'all'
  const visible = (row) => passes(filter, row) && (!query.length || query.every((word) => `${row.name} ${row.hint} ${row.word || ''}`.toLowerCase().includes(word)))
  const fold = (id) => setFolded((set) => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next })

  return (
    <section className="short-table">
      <div className="short-tools">
        <Choice label="Show" value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      <div className="short-card" role="table" aria-label="Words and keys">
        <div className="short-head" role="row">
          <span role="columnheader">Name</span><span role="columnheader">Word</span><span role="columnheader">Key</span><span role="columnheader">On</span>
        </div>
        {groups.map((group) => {
          const rows = group.rows.filter(visible)
          if (looking && rows.length === 0) return null
          const open = looking || !folded.has(group.id)
          return (
            <div key={group.id} className="short-group" data-group={group.id}>
              <div className="short-group-head" role="row">
                <button type="button" aria-expanded={open} onClick={() => fold(group.id)}>{open ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}{group.title}</button>
                {group.master && <Switch label={group.master.label} checked={group.master.checked} onChange={group.master.onChange} />}
              </div>
              {open && rows.map((row) => <ShortRow key={row.id} row={row} sends={sends} failed={failed(row.id)} wordHolder={wordHolder(row.id)} keyHolder={keyHolder(row.id)} />)}
              {open && group.add && !looking && (
                <div className="short-add">
                  <select className="setting-select" aria-label="Add an app" value="" onChange={(event) => { if (event.target.value) setPending(event.target.value) }}>
                    <option value="">Add an app…</option>
                    {installed.filter((app) => !settings.apps[app.name] && app.name !== pending).map((app) => <option key={app.path} value={app.name}>{app.name}</option>)}
                  </select>
                  <small>Give it a word or a key, and it opens the app.</small>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ShortRow({ row, sends, failed, wordHolder, keyHolder }) {
  const { icon: Icon, canWord = true, canKey = true } = row
  return (
    <div className={`short-row${row.on === false ? ' is-off' : ''}`} role="row">
      <span className="short-name" role="cell">
        <i aria-hidden="true"><Icon /></i>
        <span><b>{row.name}</b><small>{row.hint}</small></span>
      </span>
      <span className="short-word" role="cell">{canWord && <WordField value={row.word} name={row.name} holder={wordHolder} onSave={row.setWord} />}</span>
      <span className="short-key" role="cell">
        {canKey && <KeyRecorder value={row.hotkey} name={row.name} holder={keyHolder} sends={sends} failed={failed} onSet={row.setKey} />}
      </span>
      <span className="short-on" role="cell">
        {row.setOn && <Switch label={`Use ${row.name}`} checked={row.on} onChange={row.setOn} />}
        {row.remove && <button type="button" className="icon-plain" aria-label={`Take ${row.name} off`} onClick={row.remove}><X weight="bold" /></button>}
      </span>
    </div>
  )
}
