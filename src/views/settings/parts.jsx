import { createContext, useContext, useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'

import { HYPER, canonicalKey, validKeyword } from '../../../shared/launcher-model.mjs'
import { comboFrom, labelOf } from '../../lib/hotkey.js'

/* The pieces every Settings page is built from (Phase 13b), in Raycast's shape: a page has a title and one plain line,
   then groups; a group is a card of rows; a row is a bold title with a grey line on the left and its one control on
   the right. The search box at the top of Settings sets `QueryContext` (the words typed, lowercase): a row that
   doesn't match them draws nothing, and the CSS hides a group or a page with no row left. */

export const QueryContext = createContext([])
const PageContext = createContext(null)
const shown = (query, text) => query.every((word) => text.includes(word))

/* One page: its icon, title and line (hidden while searching, when the title heads what was found instead). */
export function Page({ page, children }) {
  const Icon = page.icon
  return (
    <PageContext.Provider value={page}>
      <article className="settings-section" data-page={page.id} aria-label={page.label}>
        <header className="setting-head">
          <span className="setting-tile" aria-hidden="true"><Icon weight="fill" /></span>
          <h2>{page.label}</h2>
          <p>{page.blurb}</p>
        </header>
        <h2 className="setting-found">{page.label}</h2>
        {children}
      </article>
    </PageContext.Provider>
  )
}

/* A card of rows, with a small grey title above it and a quieter line under it. */
export function Group({ title, note, children }) {
  return (
    <section className="setting-group">
      {title && <h3>{title}</h3>}
      <div className="setting-card">{children}</div>
      {note && <p className="setting-note">{note}</p>}
    </section>
  )
}

/* Title and grey line on the left, the control on the right. `words` are more things the search answers to.
   `stacked` puts the control under the words (a text box, a list). */
export function Row({ title, hint, words = '', stacked = false, children }) {
  const query = useContext(QueryContext)
  if (query.length && !shown(query, `${title} ${typeof hint === 'string' ? hint : ''} ${words}`.toLowerCase())) return null
  return (
    <div className={`setting-row${stacked ? ' is-stacked' : ''}`}>
      <div className="setting-text"><b>{title}</b>{hint && <small>{hint}</small>}</div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  )
}

/* An older card, kept whole (the AI's sizes, the drop folder…): it answers the search as one piece, by its page's words
   and its own. */
export function Legacy({ words = '', children }) {
  const query = useContext(QueryContext)
  const page = useContext(PageContext)
  if (query.length && !shown(query, `${page?.label || ''} ${page?.blurb || ''} ${page?.words || ''} ${words}`.toLowerCase())) return null
  return <div className="settings-legacy">{children}</div>
}

export function Switch({ checked, onChange, label, disabled = false }) {
  return <input type="checkbox" role="switch" className="setting-switch" checked={checked} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.checked)} />
}

/* A dropdown: options are [value, words] pairs, values are strings. */
export function Select({ value, onChange, options, label }) {
  return (
    <select className="setting-select" value={String(value)} aria-label={label} onChange={(event) => onChange(event.target.value)}>
      {options.map(([id, text]) => <option key={id} value={String(id)}>{text}</option>)}
    </select>
  )
}

/* A few choices side by side. */
export function Choice({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  )
}

const SYMBOLS = { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' }

/* A key as little keycaps: "Hyper S", "⌥ Space". */
export function Caps({ value }) {
  const parts = String(value || '').split('+')
  const key = parts.pop()
  const hyper = parts.length === 4 && HYPER.every((part) => parts.includes(part))
  return (
    <span className="caps">
      {(hyper ? ['Hyper'] : parts.map((part) => SYMBOLS[part] || part)).map((part) => <kbd key={part}>{part}</kbd>)}
      <kbd>{key}</kbd>
    </span>
  )
}

/* A word typed first ("v"): one to twelve letters or numbers. Blank takes it away. `holder(word)` names what has it. */
export function WordField({ value, name, onSave, holder, empty = 'Add word' }) {
  const [draft, setDraft] = useState(value || '')
  const [note, setNote] = useState('')
  useEffect(() => { setDraft(value || ''); setNote('') }, [value])
  function finish() {
    const word = draft.trim().toLowerCase()
    if (word === (value || '')) { setDraft(value || ''); return }
    if (!word) { onSave(null); return }
    const other = validKeyword(word) ? holder?.(word) : null
    if (!validKeyword(word) || other) {
      setNote(other ? `“${word}” is ${other}’s word already.` : 'One to twelve letters or numbers.')
      setDraft(value || '')
      return
    }
    onSave(word)
  }
  return (
    <span className="word-field">
      <input
        value={draft}
        maxLength={12}
        aria-label={`Word for ${name}`}
        placeholder={empty}
        spellCheck={false}
        onChange={(event) => { setDraft(event.target.value); setNote('') }}
        onBlur={finish}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape' && draft !== (value || '')) { event.preventDefault(); setDraft(value || '') } }}
      />
      {note && <small role="status">{note}</small>}
    </span>
  )
}

/* Press the new keys; Esc leaves it as it was; ⌫ (or the ×) takes the key away. A key someone already has is named,
   and stays with them. `sends` is what the Hyper key sends (Settings → Keyboard). */
export function KeyRecorder({ value, name, onSet, holder, failed = false, status = '', sends = 'four', clearable = true, empty = 'Record key' }) {
  const [recording, setRecording] = useState(false)
  const [note, setNote] = useState('')
  function press(event) {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') { setRecording(false); return }
    if (clearable && (event.key === 'Backspace' || event.key === 'Delete')) { setRecording(false); onSet(null); return }
    const heard = comboFrom(event)
    if (!heard) return
    if (heard.error) { setNote(heard.error); return }
    const combo = canonicalKey(heard.combo, sends)
    const other = holder?.(combo)
    if (other) { setNote(`${labelOf(combo)} is ${other}’s key already.`); return }
    setRecording(false)
    onSet(combo)
  }
  return (
    <span className="key-recorder">
      <span className="key-line">
        <button
          type="button"
          className={`key-pill${recording ? ' is-recording' : ''}${value ? '' : ' is-empty'}`}
          aria-label={`Key for ${name}`}
          onClick={() => { setNote(''); setRecording((on) => !on) }}
          onBlur={() => setRecording(false)}
          onKeyDown={press}
        >
          {recording ? 'Press the keys…' : value ? <Caps value={value} /> : empty}
        </button>
        {clearable && value && !recording && <button type="button" className="key-clear" aria-label={`Take the key off ${name}`} onClick={() => onSet(null)}><X weight="bold" /></button>}
      </span>
      {(note || status || failed) && <small role="status">{note || status || 'Another app has this key.'}</small>}
    </span>
  )
}

/* What every launcher page says without the Mac app. */
export function OnlyInTheMacApp({ what }) {
  return (
    <Group>
      <Row title="This lives in the Mac app" hint={what} />
    </Group>
  )
}
