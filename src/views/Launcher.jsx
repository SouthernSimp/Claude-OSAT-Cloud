import { useCallback, useEffect, useState } from 'react'
import { Keyboard, LockSimple, Plus, X } from '@phosphor-icons/react'

import { DAY_CHOICES, ITEM_CHOICES } from '../../shared/clipboard-model.mjs'
import { SOURCES, validAddress, validKeyword } from '../../shared/launcher-model.mjs'
import { MAX_RING, RING_ITEMS, ringItems } from '../../shared/ring-model.mjs'
import { LAYOUTS } from '../../shared/window-layouts.mjs'
import { comboFrom, labelOf } from '../lib/hotkey.js'
import { useUndoToast } from '../lib/UndoToast.jsx'
import '../styles/launcher.css'

const explain = (error) => String(error?.message || error || 'That didn’t work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const DAYS = { 7: 'a week', 30: 'a month', 90: 'three months', 0: 'for ever' }

/* Settings → Launcher: the one place for the quick search, the line's launcher and the clipboard history. Each
   source can be turned off, given its own word and Hyper key; how the search opens; how much the clipboard keeps
   (and pausing or clearing it, with Undo); Nate's keywords; and, in plain words, the two things only he can do in
   System Settings. OSAT never changes a Mac setting itself. Everything here is saved at once (launcher.json). */
export function LauncherSettings() {
  const bridge = typeof window === 'undefined' ? null : window.osatSearch
  const [settings, setSettings] = useState(null)
  const [board, setBoard] = useState(null)
  const [status, setStatus] = useState(null)
  const [message, setMessage] = useState('')
  const [toast, showUndo] = useUndoToast()

  const look = useCallback(() => {
    bridge?.clipboard().then((list) => setBoard({ paused: list?.paused === true }), () => {})
    bridge?.status().then(setStatus, () => {})
  }, [bridge])
  useEffect(() => {
    if (!bridge) return undefined
    bridge.settings().then((value) => { if (value?.sources) setSettings(value) }, () => {})
    look()
    // Allowed in Accessibility while this is open: it shows when the window comes back.
    addEventListener('focus', look)
    const stop = bridge.onSettings((value) => { if (value?.sources) setSettings(value) })
    return () => { removeEventListener('focus', look); stop() }
  }, [bridge, look])

  /* Saved at once. If a key can't be had, main says so, and the old one stays. */
  const save = useCallback((patch) => bridge.saveSettings(patch).then((value) => { setSettings(value); setMessage('') }, (error) => {
    setMessage(explain(error))
    bridge.settings().then((value) => { if (value?.sources) setSettings(value) }, () => {})
  }), [bridge])

  if (!bridge) {
    return (
      <section className="content-card">
        <p className="eyebrow">LAUNCHER</p>
        <h2>The launcher lives in the Mac app.</h2>
        <p>In the Mac app, a small bar opens over your other apps to find a file, something you copied, an app or a note, and go straight to it.</p>
      </section>
    )
  }
  if (!settings) return <section className="content-card"><p className="eyebrow">LAUNCHER</p><h2>Looking at this Mac…</h2></section>

  const sources = SOURCES.filter((source) => source.panel !== false)
  return (
    <>
      <section className="content-card launcher-card">
        <p className="eyebrow">QUICK SEARCH</p>
        <h2>Where it looks, and how you reach each place.</h2>
        <p>Its shortcut is in General. Each place can have a word (type it first, in the search or in the line) and a Hyper key that opens the search right there.</p>
        <ul className="launcher-sources">
          {sources.map((source) => {
            const own = settings.sources[source.id]
            const hasKeys = source.letter !== null
            return (
              <li key={source.id} className={own.on ? '' : 'is-off'}>
                <label className="launcher-switch">
                  <input type="checkbox" role="switch" checked={own.on} onChange={(event) => save({ sources: { [source.id]: { on: event.target.checked } } })} aria-label={`Look in ${source.label}`} />
                  <span><b>{source.label}</b><small>{source.blurb}</small></span>
                </label>
                {hasKeys && own.on && (
                  <div className="launcher-keys">
                    <Word value={own.keyword} label={`Word for ${source.label}`} onSave={(keyword) => save({ sources: { [source.id]: { keyword } } })} />
                    <KeyButton value={own.hotkey} name={source.label} failed={status?.keysFailed?.includes(`source:${source.id}`)} onSet={(hotkey) => save({ sources: { [source.id]: { hotkey } } })} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <div className="launcher-row">
          <p><strong>How it opens</strong>A small bar first, growing as you type, or the full view straight away.</p>
          <div className="segmented" role="radiogroup" aria-label="How the quick search opens">
            {[['bar', 'A small bar'], ['full', 'The full view']].map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={settings.view === id} className={settings.view === id ? 'active' : ''} onClick={() => save({ view: id })}>{label}</button>
            ))}
          </div>
        </div>
        {message && <p className="launcher-message" role="status">{message}</p>}
      </section>

      <section className="content-card launcher-card">
        <p className="eyebrow">CLIPBOARD</p>
        <h2>{board?.paused ? 'Not keeping what you copy.' : 'What you copy is kept, only on this Mac.'}</h2>
        <p>Search it with v (or the Clipboard tab), and paste from it. Copies from password managers are never kept, and neither is anything OSAT copies for itself. A pinned copy stays whatever the limits below say.</p>
        <div className="button-row">
          <button className="outline-button" type="button" onClick={() => bridge.pauseClipboard(!board?.paused).then((paused) => setBoard({ paused }), (error) => setMessage(explain(error)))}>
            {board?.paused ? 'Keep what I copy again' : 'Pause'}
          </button>
          <button className="text-button" type="button" onClick={async () => {
            try {
              const token = await bridge.clearClipboard()
              showUndo('Cleared the clipboard history', token && token !== 'empty' ? () => bridge.undoClip(token) : undefined)
            } catch (error) { setMessage(explain(error)) }
          }}>Clear the history</button>
        </div>
        <div className="launcher-row">
          <p><strong>How much to keep</strong>The newest copies stay; older ones go quietly.</p>
          <div className="launcher-picks">
            <label>The last <select value={settings.clipboard.items} onChange={(event) => save({ clipboard: { items: Number(event.target.value) } })} aria-label="How many copies to keep">
              {ITEM_CHOICES.map((count) => <option key={count} value={count}>{count} copies</option>)}
            </select></label>
            <label>for <select value={settings.clipboard.days} onChange={(event) => save({ clipboard: { days: Number(event.target.value) } })} aria-label="How long to keep a copy">
              {DAY_CHOICES.map((days) => <option key={days} value={days}>{DAYS[days]}</option>)}
            </select></label>
          </div>
        </div>
        <label className="launcher-check">
          <input type="checkbox" checked={settings.clipboard.offers !== false} onChange={(event) => save({ clipboard: { offers: event.target.checked } })} />
          <span>Offer to add a copied email address or phone number to its node, when that node already exists.</span>
        </label>
      </section>

      <section className="content-card launcher-card">
        <p className="eyebrow">WINDOW LAYOUTS</p>
        <h2>Snap a window to a half, a third or a corner.</h2>
        <p>Type “left half” in the quick search (or w and a word), and the window you were in moves there. Keys that work from any app are off until you turn them on. Moving windows needs OSAT to be allowed in Accessibility (see Pasting and windows, below).</p>
        <label className="launcher-check">
          <input type="checkbox" checked={settings.windows.on} onChange={(event) => save({ windows: { on: event.target.checked } })} />
          <span>Use keys to move the window I’m in, from any app.</span>
        </label>
        {settings.windows.on && (
          <ul className="launcher-layouts">
            {LAYOUTS.map((layout) => (
              <li key={layout.id}>
                <span>{layout.label}</span>
                <KeyButton value={settings.windows.hotkeys[layout.id]} name={layout.label} failed={status?.keysFailed?.includes(`snap:${layout.id}`)} onSet={(key) => save({ windows: { hotkeys: { [layout.id]: key } } })} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <RingCard settings={settings} save={save} status={status} />

      <KeywordsCard settings={settings} save={save} showUndo={showUndo} />

      <section className="content-card launcher-card">
        <p className="eyebrow">ON YOUR MAC</p>
        <h2>Two things only you can change.</h2>
        <p>OSAT never changes a setting on your Mac for you. If you want these, here is where they live.</p>
        <dl className="launcher-steps">
          <div>
            <dt>A Hyper key</dt>
            <dd>Hyper is ⌃⌥⇧⌘ held together, and OSAT already listens for it with a letter (V for the clipboard, S for files). macOS can’t turn Caps Lock into all four by itself; a free app such as Hyperkey or Karabiner-Elements can. Set it up there, or just hold the four keys.</dd>
          </div>
          <div>
            <dt>⌘Space for the quick search</dt>
            <dd>In System Settings → Keyboard → Keyboard Shortcuts → Spotlight, untick “Show Spotlight search”. Then pick ⌘Space for the quick search in General.</dd>
          </div>
        </dl>
      </section>

      {status?.accessibility && status.accessibility !== 'unavailable' && (
        <section className="content-card launcher-card">
          <p className="eyebrow">PASTING AND WINDOWS</p>
          <h2>{status.accessibility === 'granted' ? 'OSAT can paste and move windows for you.' : 'OSAT can paste and move windows, once you allow it.'}</h2>
          <p>
            {status.accessibility === 'granted'
              ? 'Return on a copy puts it into the app you were in, and a layout moves the window you were in.'
              : 'Without this, Return on a copy puts it on the clipboard and OSAT says “Press ⌘V”, and a layout says what is waiting; nothing else changes. To turn it on, macOS wants you to allow OSAT under Accessibility. OSAT asks only when you press the button below.'}
          </p>
          {status.accessibility !== 'granted' && (
            <div className="button-row">
              <button className="outline-button" type="button" onClick={() => bridge.askAccess().then(() => setTimeout(look, 1500), () => {})}><LockSimple /> Allow in Accessibility…</button>
            </div>
          )}
        </section>
      )}
      {toast}
    </>
  )
}

/* The word typed first ("v"): one to twelve letters or numbers; a blank one turns the word off. */
function Word({ value, label, onSave }) {
  const [draft, setDraft] = useState(value || '')
  useEffect(() => setDraft(value || ''), [value])
  const finish = () => {
    const word = draft.trim().toLowerCase()
    if (word === (value || '')) return
    if (!word) onSave(null)
    else if (validKeyword(word)) onSave(word)
    else setDraft(value || '')
  }
  return (
    <label className="launcher-word">
      <span>Word</span>
      <input value={draft} maxLength={12} aria-label={label} placeholder="none" spellCheck={false} onChange={(event) => setDraft(event.target.value)} onBlur={finish} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    </label>
  )
}

/* Press the new keys; Esc leaves it as it was; None takes the key away. */
function KeyButton({ value, name, failed, onSet }) {
  const [recording, setRecording] = useState(false)
  const [note, setNote] = useState('')
  return (
    <span className="launcher-hotkey">
      <button
        type="button"
        className={recording ? 'primary-button' : 'outline-button'}
        aria-label={`Key for ${name}`}
        onClick={() => { setNote(''); setRecording((on) => !on) }}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (!recording) return
          event.preventDefault()
          if (event.key === 'Escape') { setRecording(false); return }
          const heard = comboFrom(event)
          if (!heard) return
          if (heard.error) { setNote(heard.error); return }
          setRecording(false)
          onSet(heard.combo)
        }}
      >
        <Keyboard /> {recording ? 'Press the keys…' : value ? labelOf(value) : 'No key'}
      </button>
      {value && !recording && <button type="button" className="text-button" aria-label={`Take the key off ${name}`} onClick={() => onSet(null)}>None</button>}
      {(note || failed) && <small role="status">{note || 'Another app has this key.'}</small>}
    </span>
  )
}

/* The ring: which tools, and its key. */
function RingCard({ settings, save, status }) {
  const chosen = ringItems(settings.ring.items).map((item) => item.id)
  const toggle = (id, on) => save({ ring: { items: on ? [...chosen, id] : chosen.filter((other) => other !== id) } })
  return (
    <section className="content-card launcher-card">
      <p className="eyebrow">THE RING</p>
      <h2>Quick tools in a circle around your pointer.</h2>
      <p>Press its key from any app, or hold ⌘ and middle-click anywhere in OSAT. Over other apps, ⌘ and middle-click would need a helper that watches every click, which OSAT doesn’t install, so the key does that job.</p>
      <label className="launcher-check">
        <input type="checkbox" checked={settings.ring.on} onChange={(event) => save({ ring: { on: event.target.checked } })} />
        <span>Use the ring.</span>
      </label>
      {settings.ring.on && (
        <>
          <div className="launcher-row">
            <p><strong>Its key</strong>Works from any app.</p>
            <KeyButton value={settings.ring.hotkey} name="the ring" failed={status?.keysFailed?.includes('ring')} onSet={(hotkey) => save({ ring: { hotkey } })} />
          </div>
          <p className="launcher-subhead">What it holds: up to {MAX_RING}, in this order. The layouts move the window you were in, so they only show over other apps.</p>
          <ul className="launcher-ringitems">
            {RING_ITEMS.map((item) => (
              <li key={item.id}>
                <label>
                  <input type="checkbox" checked={chosen.includes(item.id)} disabled={!chosen.includes(item.id) && chosen.length >= MAX_RING} onChange={(event) => toggle(item.id, event.target.checked)} />
                  <span>{item.label}{chosen.includes(item.id) && <small>{chosen.indexOf(item.id) + 1}</small>}</span>
                </label>
              </li>
            ))}
          </ul>
          <button className="text-button" type="button" onClick={() => save({ ring: { items: null } })}>Back to the usual tools</button>
        </>
      )}
    </section>
  )
}

/* ss → Spotify, g → a web search: short words that open an app or a web address (put {query} where the words go). */
function KeywordsCard({ settings, save, showUndo }) {
  const [word, setWord] = useState('')
  const [target, setTarget] = useState('')
  const web = /^https?:\/\//i.test(target.trim())
  const taken = new Set([...Object.values(settings.sources).map((source) => source.keyword), ...settings.keywords.map((item) => item.keyword)])
  const ready = validKeyword(word) && !taken.has(word.trim().toLowerCase()) && target.trim() && (!web || validAddress(target))

  function add(event) {
    event.preventDefault()
    if (!ready) return
    const keyword = word.trim().toLowerCase()
    const label = web ? new URL(target.trim().replace('{query}', 'x')).host.replace(/^www\./, '') : target.trim()
    const item = { id: `kw-${keyword}-${Date.now()}`, keyword, label, ...(web ? { url: target.trim() } : { app: target.trim() }) }
    save({ keywords: [...settings.keywords, item] })
    setWord('')
    setTarget('')
  }

  function remove(item) {
    const before = settings.keywords
    save({ keywords: before.filter((other) => other.id !== item.id) })
    showUndo(`Took off “${item.keyword}”`, () => save({ keywords: before }))
  }

  return (
    <section className="content-card launcher-card">
      <p className="eyebrow">YOUR WORDS</p>
      <h2>Short words that open things.</h2>
      <p>Type one in the line or the quick search. An app opens on its word alone; a web address wants words after it, like <b>g best CRMs</b>. Swap Spotify for Music by changing the name.</p>
      {settings.keywords.length > 0 && (
        <ul className="launcher-words">
          {settings.keywords.map((item) => (
            <li key={item.id}>
              <kbd>{item.keyword}</kbd>
              <span>{item.app ? <>Opens <b>{item.app}</b></> : <>Searches <b>{item.label}</b></>}<small>{item.app ? 'An app' : item.url}</small></span>
              <button type="button" className="text-button" aria-label={`Take off ${item.keyword}`} onClick={() => remove(item)}><X /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="launcher-add" onSubmit={add}>
        <label><span>Word</span><input value={word} maxLength={12} placeholder="ss" spellCheck={false} aria-label="A new word" onChange={(event) => setWord(event.target.value)} /></label>
        <label><span>Opens</span><input value={target} maxLength={300} placeholder="Spotify, or https://www.google.com/search?q={query}" spellCheck={false} aria-label="What it opens" onChange={(event) => setTarget(event.target.value)} /></label>
        <button className="outline-button" type="submit" disabled={!ready}><Plus /> Add</button>
      </form>
      {word && taken.has(word.trim().toLowerCase()) && <p className="launcher-message" role="status">“{word.trim().toLowerCase()}” is already a word. Pick another.</p>}
    </section>
  )
}

