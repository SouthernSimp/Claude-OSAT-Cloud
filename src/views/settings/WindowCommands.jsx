import { useContext, useState } from 'react'
import { ArrowCounterClockwise, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowsIn, ArrowsOut, CaretDown, CaretRight, DotsThree, Monitor, Plus, SquaresFour } from '@phosphor-icons/react'

import { holderOf } from '../../../shared/launcher-model.mjs'
import { LAYOUTS, LAYOUT_GROUPS, MAX_CUSTOM, cleanRect, newCustomId, rectOfLayout } from '../../../shared/window-layouts.mjs'
import { KeyRecorder, QueryContext, Switch, WordField } from './parts.jsx'

/* Window commands (Phase 61), the way Raycast's Window Management lists them: Your commands on top (made here, with
   Create command), then every built-in command by kind, each with a picture of where it puts the window, a word to type
   in the bar, a key, and an On switch; "…" opens Duplicate, Reset and the rest. The table is the same list Settings →
   Shortcuts shows (`windowRows`), and every change is the same launcher setting (`windows` in launcher.json). */

const FIXED = { larger: ArrowsOut, smaller: ArrowsIn, 'move:left': ArrowLeft, 'move:right': ArrowRight, 'move:up': ArrowUp, 'move:down': ArrowDown, 'next-display': Monitor, 'previous-display': Monitor, restore: ArrowCounterClockwise }
const HINTS = { larger: 'A little bigger, around its middle', smaller: 'A little smaller, around its middle', move: 'Slides to that edge, same size', 'next-display': 'Same window, on the next screen', 'previous-display': 'Same window, on the screen before', restore: 'Where the window was before OSAT moved it' }

/* A screen with the part of it a window will take. */
export function Region({ box }) {
  const [x, y, w, h] = box
  return (
    <svg className="region" viewBox="0 0 20 14" aria-hidden="true">
      <rect className="region-screen" x="0.5" y="0.5" width="19" height="13" rx="2.5" />
      <rect className="region-fill" x={1 + x * 18} y={1 + y * 12} width={Math.max(0.8, w * 18)} height={Math.max(0.8, h * 12)} rx="0.8" />
    </svg>
  )
}

// The table gives each row an icon component; one per picture, made once.
const icons = new Map()
function iconFor(layout) {
  const name = layout.box ? layout.box.join(',') : layout.op === 'move' ? `move:${layout.to}` : layout.op
  if (!icons.has(name)) icons.set(name, layout.box ? () => <Region box={layout.box} /> : FIXED[name] || SquaresFour)
  return icons.get(name)
}

const describe = (item) => `${item.centered ? 'In the middle' : `${item.rect.x}% across, ${item.rect.y}% down`}, ${item.rect.w}% wide, ${item.rect.h}% tall`

/* Every window command as a row of the shortcuts table: Nate's own first (`mine`), then the built-in ones in order
   (`all` has both; `groups` the built-in ones by kind). Changing a row saves the same launcher setting everywhere. */
export function windowRows(settings, save, status) {
  const w = settings.windows
  const off = w.off || []
  const make = (layout, extra) => {
    const id = layout.id
    return {
      id: `snap:${id}`, key: id, layout, icon: iconFor(layout), name: layout.label, word: w.aliases?.[id] || null, hotkey: w.hotkeys[id] ?? null, on: !off.includes(id), failed: status?.keysFailed?.includes(`snap:${id}`),
      setWord: (word) => save({ windows: { aliases: { [id]: word } } }),
      setKey: (hotkey) => save({ windows: { hotkeys: { [id]: hotkey } } }),
      setOn: (on) => save({ windows: { off: on ? off.filter((other) => other !== id) : [...off, id] } }),
      ...extra,
    }
  }
  const mine = (w.custom || []).map((item) => make({ id: item.id, label: item.name, box: [item.rect.x / 100, item.rect.y / 100, item.rect.w / 100, item.rect.h / 100] }, { hint: describe(item), item }))
  const groups = LAYOUT_GROUPS.map((group) => ({
    ...group,
    rows: LAYOUTS.filter((layout) => layout.group === group.id).map((layout) => make(layout, {
      hint: layout.box ? `${Math.round(layout.box[2] * 100)}% wide, ${Math.round(layout.box[3] * 100)}% tall` : HINTS[layout.op] || '',
      changed: (w.hotkeys[layout.id] ?? null) !== layout.key || Boolean(w.aliases?.[layout.id]) || off.includes(layout.id),
    })),
  }))
  return { mine, groups, all: [...mine, ...groups.flatMap((group) => group.rows)] }
}

/* ---------------------------------------------------------------------------------------------------------------- */

export function WindowCommands({ launcher }) {
  const { settings, save, showUndo } = launcher
  const query = useContext(QueryContext)
  const { mine, groups } = windowRows(settings, save, launcher.status)
  const [folded, setFolded] = useState(() => new Set(LAYOUT_GROUPS.map((group) => group.id).filter((id) => !['halves', 'quarters'].includes(id))))
  const [form, setForm] = useState(null) // 'new', or the id of the command being edited
  const [more, setMore] = useState(null) // the row whose “…” is open
  const w = settings.windows
  const full = w.custom.length >= MAX_CUSTOM
  const keyHolder = (id) => (combo) => holderOf(settings, { key: combo }, `snap:${id}`)
  const wordHolder = (id) => (word) => holderOf(settings, { word }, `snap:${id}`)
  const looking = query.length > 0
  const shown = (row) => !looking || query.every((word) => `${row.name} ${row.hint} ${row.word || ''} ${row.layout.words || ''}`.toLowerCase().includes(word))
  const fold = (id) => setFolded((set) => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next })

  const addCustom = (made, said) => {
    const before = w.custom
    const item = { id: newCustomId(before), ...made }
    save({ windows: { custom: [...before, item] } })
    showUndo(said(item), () => save({ windows: { custom: before } }))
  }
  const duplicate = (row) => {
    const rect = row.item ? row.item.rect : rectOfLayout(row.layout)
    if (!rect || full) return
    addCustom({ name: `${row.name} copy`.slice(0, 40), rect, ...(row.item?.centered ? { centered: true } : {}) }, (item) => `Made “${item.name}”`)
    setMore(null)
  }
  const remove = (row) => {
    save({ windows: { custom: w.custom.filter((item) => item.id !== row.key) } })
    // Undo puts back the command with its word, its key and its switch.
    showUndo(`Deleted “${row.name}”`, () => save({ windows: { custom: w.custom, aliases: w.aliases?.[row.key] ? { [row.key]: w.aliases[row.key] } : {}, hotkeys: { [row.key]: row.hotkey }, off: w.off || [] } }))
    setMore(null)
  }
  const reset = (row) => {
    const before = { key: row.hotkey, word: row.word, off: w.off || [] }
    save({ windows: { hotkeys: { [row.key]: row.layout.key }, aliases: { [row.key]: null }, off: before.off.filter((id) => id !== row.key) } })
    showUndo(`Put “${row.name}” back as it came`, () => save({ windows: { hotkeys: { [row.key]: before.key }, aliases: { [row.key]: before.word }, off: before.off } }))
    setMore(null)
  }

  const rowFor = (row, mineRow) => {
    const open = more === row.key
    const actions = mineRow
      ? [['Edit', () => { setForm(row.key); setMore(null) }], ['Duplicate', () => duplicate(row)], ['Delete', () => remove(row)]]
      : [...(row.layout.box ? [['Duplicate as custom', () => duplicate(row)]] : []), ...(row.changed ? [['Reset', () => reset(row)]] : []), [row.on ? 'Turn off' : 'Turn on', () => { row.setOn(!row.on); setMore(null) }]]
    return (
      <div key={row.id} className="short-row-wrap">
        <div className={`short-row${row.on ? '' : ' is-off'}`} role="row">
          <span className="short-name" role="cell">
            <i aria-hidden="true"><row.icon /></i>
            <span><b>{row.name}</b><small>{row.hint}</small></span>
          </span>
          <span className="short-word" role="cell"><WordField value={row.word} name={row.name} holder={wordHolder(row.key)} onSave={row.setWord} empty="Add alias" /></span>
          <span className="short-key" role="cell"><KeyRecorder value={row.hotkey} name={row.name} holder={keyHolder(row.key)} sends={settings.hyper.sends} failed={row.failed} onSet={row.setKey} /></span>
          <span className="short-on" role="cell">
            <Switch label={`Use ${row.name}`} checked={row.on} onChange={row.setOn} />
            <button type="button" className="icon-plain" aria-label={`More for ${row.name}`} aria-expanded={open} onClick={() => setMore(open ? null : row.key)}><DotsThree weight="bold" /></button>
          </span>
        </div>
        {open && (
          <div className="short-more" role="group" aria-label={`More for ${row.name}`}>
            {actions.map(([label, run]) => <button key={label} type="button" className="outline-button" onClick={run}>{label}</button>)}
          </div>
        )}
      </div>
    )
  }

  const mineShown = mine.filter(shown)
  return (
    <section className="short-table window-table">
      <div className="short-card" role="table" aria-label="Window commands">
        <div className="short-head" role="row">
          <span role="columnheader">Name</span><span role="columnheader">Alias</span><span role="columnheader">Key</span><span role="columnheader">On</span>
        </div>
        {(!looking || mineShown.length > 0) && (
          <div className="short-group" data-group="custom">
            <div className="short-group-head" role="row">
              <span className="short-group-title">Your commands</span>
              <button type="button" className="outline-button" onClick={() => { setForm('new'); setMore(null) }} disabled={full} title={full ? `That’s the most (${MAX_CUSTOM})` : undefined}><Plus weight="bold" /> Create command</button>
            </div>
            {form === 'new' && <CommandForm key="new" onCancel={() => setForm(null)} onSave={(made) => { addCustom(made, (item) => `Made “${item.name}”`); setForm(null) }} />}
            {mine.map((row) => (form === row.key
              ? <CommandForm key={row.key} initial={row.item} onCancel={() => setForm(null)} onSave={(made) => { save({ windows: { custom: w.custom.map((item) => (item.id === row.key ? { id: item.id, ...made } : item)) } }); setForm(null) }} />
              : shown(row) && rowFor(row, true)))}
            {mine.length === 0 && form !== 'new' && !looking && <p className="short-add">None yet. Create command makes a place of your own, like a bottom right ninth. It gets an alias and a key like the rest.</p>}
          </div>
        )}
        {groups.map((group) => {
          const rows = group.rows.filter(shown)
          if (looking && rows.length === 0) return null
          const open = looking || !folded.has(group.id)
          return (
            <div key={group.id} className="short-group" data-group={group.id}>
              <div className="short-group-head" role="row">
                <button type="button" aria-expanded={open} onClick={() => fold(group.id)}>{open ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}{group.title}</button>
              </div>
              {open && rows.map((row) => rowFor(row, false))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* Create command / Edit: a name, where the window goes as percents of the screen, a little picture of it. */
function CommandForm({ initial = null, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '')
  const [centered, setCentered] = useState(initial?.centered === true)
  const [rect, setRect] = useState(() => Object.fromEntries(['x', 'y', 'w', 'h'].map((key) => [key, String(initial?.rect?.[key] ?? { x: 25, y: 25, w: 50, h: 50 }[key])])))
  const fixed = cleanRect(rect, centered)
  const ready = Boolean(name.trim() && fixed)
  const set = (key) => (event) => setRect((now) => ({ ...now, [key]: event.target.value }))
  const field = (key, label, off = false) => (
    <label><span>{label}</span><input type="number" inputMode="decimal" min="0" max="100" step="any" value={off && fixed ? String(fixed[key]) : rect[key]} disabled={off} aria-label={`${label}, percent of the screen`} onChange={set(key)} /></label>
  )
  function submit(event) {
    event.preventDefault()
    if (ready) onSave({ name: name.trim().slice(0, 40), rect: fixed, ...(centered ? { centered: true } : {}) })
  }
  return (
    <form className="window-form" onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}>
      <div className="window-fields">
        <label className="is-wide"><span>Name</span><input value={name} maxLength={40} placeholder="Bottom Right Ninth" aria-label="Name of the command" autoFocus onChange={(event) => setName(event.target.value)} /></label>
        {field('x', 'From the left %', centered)}
        {field('y', 'From the top %', centered)}
        {field('w', 'Width %')}
        {field('h', 'Height %')}
        <label className="window-check"><input type="checkbox" checked={centered} onChange={(event) => setCentered(event.target.checked)} /> Centered</label>
        <div className="window-buttons">
          <button className="primary-button" type="submit" disabled={!ready}>{initial ? 'Save' : 'Create'}</button>
          <button className="outline-button" type="button" onClick={onCancel}>Cancel</button>
        </div>
        {!fixed && <small className="setting-inline" role="status">Use numbers from 0 to 100.</small>}
      </div>
      <div className="window-preview" aria-label="Where the window will go">
        <Region box={fixed ? [fixed.x / 100, fixed.y / 100, fixed.w / 100, fixed.h / 100] : [0, 0, 0, 0]} />
        <small>{fixed ? `${fixed.w}% × ${fixed.h}% of the screen` : ''}</small>
      </div>
    </form>
  )
}
