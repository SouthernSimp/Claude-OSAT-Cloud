import { createContext, useContext, useEffect, useState } from 'react'
import { AppWindow, CaretDown, CaretRight, Calculator, ClipboardText, Files, Link, NotePencil, SquaresFour, Target, X } from '@phosphor-icons/react'

import { SOURCES, holderOf } from '../../../shared/launcher-model.mjs'
import { CAPTURES } from '../../../shared/capture-model.mjs'
import { AppIcon, CAPTURE_ICONS } from '../../search/icons.jsx'
import { KeysInUse } from './KeysInUse.jsx'
import { LauncherPage } from './launcher.jsx'
import { useCaptureStatus } from './screenshots.jsx'
import { Choice, KeyRecorder, QueryContext, Switch, WordField } from './parts.jsx'
import { windowRows } from './WindowCommands.jsx'

/* Settings → Shortcuts (Phase 13b): every word and every key, in one table, the way Raycast's Shortcuts tab does it:
   Name, Word, Key, On. Groups fold; a filter narrows to what has a key, a word, or is off. Nothing here is a second copy:
   a row changes the same launcher setting its own page does. A key someone already has is named, and stays with them. */

const ICONS = { files: Files, clipboard: ClipboardText, apps: AppWindow, notes: NotePencil, calc: Calculator, windows: SquaresFour }
const TINTS = { files: 'sky', clipboard: 'sky', apps: 'indigo', notes: 'yellow', calc: 'graphite', windows: 'blue' }
// Short words for the places, so a row reads in one line.
const HINTS = { files: 'Files on this Mac', clipboard: 'What you copied', apps: 'Open any app', notes: 'Notes and topics', calc: 'Sums, units, dates', windows: 'Snap the window you’re in' }
const LauncherBridge = createContext({ bridge: null })
const FILTERS = [['all', 'All'], ['key', 'Has a key'], ['word', 'Has a word'], ['off', 'Off']]
const passes = (filter, row) => filter === 'all' || (filter === 'key' && row.hotkey) || (filter === 'word' && row.word) || (filter === 'off' && row.on === false)

export function ShortcutsPage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app, give anything a word to type or a key to press.">
      {(launcher) => <Table launcher={launcher} />}
    </LauncherPage>
  )
}

function Table({ launcher }) {
  const { bridge, settings, status, save } = launcher
  const query = useContext(QueryContext)
  const [filter, setFilter] = useState('all')
  const [folded, setFolded] = useState(() => new Set(['windows', 'apps']))
  const [installed, setInstalled] = useState([])
  const [shooting] = useCaptureStatus(bridge)
  useEffect(() => { bridge.apps().then((list) => setInstalled(Array.isArray(list) ? list : []), () => {}) }, [bridge])
  const sends = settings.hyper.sends
  const failed = (id) => status?.keysFailed?.includes(id)
  const wordHolder = (id) => (word) => holderOf(settings, { word }, id)
  const keyHolder = (id) => (combo) => holderOf(settings, { key: combo }, id)
  const editLink = (id, patch) => save({ links: settings.links.map((link) => (link.id === id ? { ...link, ...patch } : link)) })
  const setApp = (name, patch) => save({ apps: { [name]: patch } })

  const places = SOURCES.map((source) => {
    const own = settings.sources[source.id]
    const has = source.letter !== null
    return {
      id: `source:${source.id}`, icon: ICONS[source.id], tint: TINTS[source.id], name: source.label, hint: HINTS[source.id] || source.blurb, word: own.keyword, hotkey: own.hotkey, on: own.on, canWord: has, canKey: has,
      setWord: (keyword) => save({ sources: { [source.id]: { keyword } } }),
      setKey: (hotkey) => save({ sources: { [source.id]: { hotkey } } }),
      setOn: (on) => save({ sources: { [source.id]: { on } } }),
    }
  })
  // Every app on this Mac is a row with its own icon (Raycast's Applications list); the ones with a word or a key are
  // "Your apps", open; the rest wait folded under "Every other app".
  const pathOf = new Map(installed.map((app) => [app.name, app.path]))
  const appNames = [...new Set([...Object.keys(settings.apps), ...installed.map((app) => app.name)])].sort((a, b) => a.localeCompare(b))
  const apps = appNames.map((name) => {
    const own = settings.apps[name] || {}
    return {
      id: `app:${name}`, icon: AppWindow, tint: 'indigo', appPath: pathOf.get(name) || null, name, hint: '', word: own.keyword || null, hotkey: own.hotkey || null, on: true, mine: Boolean(own.keyword || own.hotkey),
      setWord: (keyword) => setApp(name, { keyword }),
      setKey: (hotkey) => setApp(name, { hotkey }),
      remove: settings.apps[name] ? () => save({ apps: { [name]: null } }) : null,
    }
  })
  const links = settings.links.map((link) => ({
    id: `link:${link.id}`, icon: Link, tint: 'blue', name: link.name, hint: link.url, word: link.keyword, hotkey: link.hotkey, on: link.on !== false,
    setWord: (keyword) => editLink(link.id, { keyword }),
    setKey: (hotkey) => editLink(link.id, { hotkey }),
    setOn: (on) => editLink(link.id, { on }),
  }))
  // Window layouts (Phase 61): Nate's own commands and the built-in ones, from the one list Settings → Window layouts shows.
  const layouts = windowRows(settings, save, status).all
  const ring = [{
    id: 'ring', icon: Target, tint: 'rose', name: 'The ring', hint: 'Tools around your pointer', word: null, hotkey: settings.ring.hotkey, on: settings.ring.on, canWord: false,
    setKey: (hotkey) => save({ ring: { hotkey } }), setOn: (on) => save({ ring: { on } }),
  }]
  const captures = CAPTURES.filter((item) => shooting?.list.includes(item.id)).map((item) => ({
    id: `capture:${item.id}`, icon: CAPTURE_ICONS[item.id] || ClipboardText, tint: 'pink', name: item.label, hint: shooting.cleanshot ? 'CleanShot X' : 'The Mac’s screenshot', word: null, hotkey: settings.captures.hotkeys[item.id], on: true, canWord: false,
    setKey: (hotkey) => save({ captures: { hotkeys: { [item.id]: hotkey } } }),
  }))
  const groups = [
    { id: 'places', title: 'Places', rows: places },
    { id: 'my-apps', title: 'Your apps', rows: apps.filter((row) => row.mine) },
    { id: 'apps', title: 'Every other app', rows: apps.filter((row) => !row.mine) },
    { id: 'links', title: 'Quick links', rows: links },
    { id: 'windows', title: 'Window layouts', rows: layouts, master: { label: 'Use keys to move the window I’m in, from any app', checked: settings.windows.on, onChange: (on) => save({ windows: { on } }) } },
    { id: 'ring', title: 'The ring', rows: ring },
    { id: 'captures', title: 'Screenshots', rows: captures },
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
          if ((looking || group.id === 'my-apps') && rows.length === 0) return null
          const open = looking || !folded.has(group.id)
          return (
            <div key={group.id} className="short-group" data-group={group.id}>
              <div className="short-group-head" role="row">
                <button type="button" aria-expanded={open} onClick={() => fold(group.id)}>{open ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}{group.title}</button>
                {group.master && <Switch label={group.master.label} checked={group.master.checked} onChange={group.master.onChange} />}
              </div>
              {open && <LauncherBridge.Provider value={{ bridge }}>{rows.map((row) => <ShortRow key={row.id} row={row} sends={sends} failed={failed(row.id)} wordHolder={wordHolder(row.id)} keyHolder={keyHolder(row.id)} />)}</LauncherBridge.Provider>}
            </div>
          )
        })}
      </div>
      <KeysInUse settings={settings} />
    </section>
  )
}

function ShortRow({ row, sends, failed, wordHolder, keyHolder }) {
  const { icon: Icon, canWord = true, canKey = true } = row
  const { bridge } = useContext(LauncherBridge)
  return (
    <div className={`short-row${row.on === false ? ' is-off' : ''}`} role="row">
      <span className="short-name" role="cell">
        {row.appPath && bridge ? <span className="short-app"><AppIcon bridge={bridge} row={{ kind: 'app', data: { path: row.appPath } }} /></span>
          : <span className="tile short-tile" data-tint={row.tint || 'graphite'} aria-hidden="true"><Icon weight="fill" /></span>}
        <span><b>{row.name}</b>{row.hint && <small>{row.hint}</small>}</span>
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
