import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, LockSimple, Plus, X } from '@phosphor-icons/react'

import { DAY_CHOICES, ITEM_CHOICES } from '../../../shared/clipboard-model.mjs'
import { SOURCES, hostOf, holderOf, validAddress, validKeyword } from '../../../shared/launcher-model.mjs'
import { MAX_RING, RING_ITEMS, ringItems } from '../../../shared/ring-model.mjs'
import { LAYOUTS } from '../../../shared/window-layouts.mjs'
import { Choice, Group, KeyRecorder, OnlyInTheMacApp, Page, Row, Select, Switch, WordField } from './parts.jsx'

/* Settings' launcher pages (Phase 13b). One provider gives every page the same picture of the launcher: its settings
   (main keeps them in launcher.json and tells every window when they change), whether the clipboard is paused, and
   what macOS lets OSAT do. Each change is saved at once. If a key can't be had, main says so, and the old one stays. */

const LauncherContext = createContext(null)
export const useLauncher = () => useContext(LauncherContext)
export const explain = (error) => String(error?.message || error || 'That didn’t work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const DAYS = { 7: 'a week', 30: 'a month', 90: 'three months', 0: 'for ever' }

export function LauncherProvider({ showUndo, children }) {
  const bridge = typeof window === 'undefined' ? null : window.osatSearch
  const [settings, setSettings] = useState(null)
  const [board, setBoard] = useState(null)
  const [status, setStatus] = useState(null)
  const [message, setMessage] = useState('')

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

  const save = useCallback((patch) => bridge.saveSettings(patch).then((value) => { setSettings(value); setMessage('') }, (error) => {
    setMessage(explain(error))
    bridge.settings().then((value) => { if (value?.sources) setSettings(value) }, () => {})
  }), [bridge])

  const value = { bridge, settings, board, setBoard, status, look, save, showUndo, setMessage }
  return (
    <LauncherContext.Provider value={value}>
      {message && <p className="settings-message" role="status">{message}</p>}
      {children}
    </LauncherContext.Provider>
  )
}

/* A launcher page: its title, then its groups. Without the Mac app there is nothing to show but where it lives. */
export function LauncherPage({ page, what, children }) {
  const launcher = useLauncher()
  if (!launcher.bridge) return <Page page={page}><OnlyInTheMacApp what={what} /></Page>
  if (!launcher.settings) return <Page page={page}><Group><Row title="Looking at this Mac…" /></Group></Page>
  return <Page page={page}>{children(launcher)}</Page>
}

const holders = (settings) => ({
  key: (id) => (combo) => holderOf(settings, { key: combo }, id),
  word: (id) => (word) => holderOf(settings, { word }, id),
})

/* The keys that show the desk and the quick bar from anywhere. Recorded here, checked by main (`validHotkey`), and
   the Mac says if another app already has one. */
export function useDeskKeys() {
  const bridge = typeof window === 'undefined' ? null : window.osatDesk
  const [info, setInfo] = useState(null)
  useEffect(() => { bridge?.prefs().then(setInfo).catch(() => {}) }, [bridge])
  const set = useCallback(async (which, combo) => {
    const saved = await bridge.setHotkey(combo, which)
    setInfo((value) => (which === 'layer' ? { ...value, ...saved } : { ...value, [which]: saved }))
  }, [bridge])
  return { bridge, info, set }
}

export function DeskKey({ which, name, keys }) {
  const { info, set } = keys
  const one = which === 'layer' ? info : info?.[which]
  const [said, setSaid] = useState('')
  return (
    <KeyRecorder
      value={one?.hotkey}
      name={name}
      clearable={false}
      failed={Boolean(one?.failed)}
      status={said}
      onSet={(combo) => set(which, combo).then(() => setSaid('Saved. Try it from any app.'), (error) => setSaid(explain(error)))}
    />
  )
}

/* ---- Quick bar --------------------------------------------------------------------------------------------------- */

const taken = (one, otherwise) => (one?.failed ? `${one.label} is already used by another app, so OSAT can’t listen for it. Choose a different shortcut.` : otherwise)

export function QuickSearchPage({ page }) {
  const keys = useDeskKeys()
  return (
    <LauncherPage page={page} what="In the Mac app, one bar opens over your other apps to find a file, something you copied, an app or a note, ask the AI, or save a sticky.">
      {({ settings, save }) => (
        <>
          <Group title="Open it" note="In the bar: Return opens what is picked, ⌘Return asks the AI about what you typed, ⌥Return saves it to Unsorted as a sticky, ⌘K lists every action, Esc backs out a step. Drag it by its edge and it opens there next time.">
            {keys.bridge && (
              <>
                <Row title="Shortcut" hint={taken(keys.info?.search, 'Brings it up over any app. Press it again, or Esc, to put it away.')} words="hotkey key open">
                  <DeskKey which="search" name="the quick bar" keys={keys} />
                </Row>
                <Row title="Ask" hint={taken(keys.info?.chat, 'Opens the bar on Ask, with the chat you were in.')} words="hotkey key ask chat ai">
                  <DeskKey which="chat" name="Ask in the quick bar" keys={keys} />
                </Row>
              </>
            )}
            <Row title="How it opens" hint="A small bar first, growing as you type, or the full view straight away." words="bar full view">
              <Choice label="How the quick bar opens" value={settings.view} onChange={(view) => save({ view })} options={[['bar', 'A small bar'], ['full', 'The full view']]} />
            </Row>
          </Group>
          <Group title="Where it looks" note="Each place can have its own word (type it first, in the search or in the line) and a Hyper key that opens the search right there. They are in Shortcuts.">
            {SOURCES.map((source) => (
              <Row key={source.id} title={source.label} hint={source.blurb}>
                <Switch label={`Look in ${source.label}`} checked={settings.sources[source.id].on} onChange={(on) => save({ sources: { [source.id]: { on } } })} />
              </Row>
            ))}
          </Group>
        </>
      )}
    </LauncherPage>
  )
}

/* ---- Keyboard ----------------------------------------------------------------------------------------------------- */

export function KeyboardPage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app, OSAT’s Hyper keys and its shortcuts work from any app.">
      {({ settings, save }) => (
        <>
          <Group title="Hyper key" note="OSAT never changes a setting on your Mac for you. This is where the two things only you can change live.">
            <Row title="Make Caps Lock a Hyper key" hint="Hyper is ⌃⌥⇧⌘ held together, and OSAT already listens for it with a letter (V for the clipboard, S for files). macOS can’t turn Caps Lock into all four by itself; a free app such as Hyperkey or Karabiner-Elements can. Set it up there, or just hold the four keys." words="caps lock karabiner hyperkey raycast" />
            <Row title="Another app makes my Hyper key" hint="If it leaves ⇧ out (Raycast’s does, unless “Include Shift” is on), choose ⌃⌥⌘ so OSAT’s Hyper keys still work." words="raycast shift modifier">
              <Select label="What the Hyper key sends" value={settings.hyper.sends} onChange={(sends) => save({ hyper: { sends } })} options={[['four', '⌃⌥⇧⌘ (all four)'], ['three', '⌃⌥⌘ (without ⇧)']]} />
            </Row>
          </Group>
          <Group title="Spotlight">
            <Row title="Use ⌘Space for the quick bar" hint="In System Settings → Keyboard → Keyboard Shortcuts → Spotlight, untick “Show Spotlight search”. Then pick ⌘Space for the quick bar in Quick bar." words="command space spotlight replace" />
          </Group>
        </>
      )}
    </LauncherPage>
  )
}

/* ---- Clipboard ---------------------------------------------------------------------------------------------------- */

/* What macOS lets OSAT do that needs its OK: paste for you, and move windows. It asks only when the button is pressed. */
function Permission() {
  const { bridge, status, look } = useLauncher()
  if (!status?.accessibility || status.accessibility === 'unavailable') return null
  const granted = status.accessibility === 'granted'
  return (
    <Group title="Permission">
      <Row
        title={granted ? 'OSAT can paste and move windows for you' : 'Allow OSAT to paste and move windows'}
        hint={granted
          ? 'Return on a copy puts it into the app you were in, and a layout moves the window you were in.'
          : 'Without this, Return on a copy puts it on the clipboard and OSAT says “Press ⌘V”, and a layout says what is waiting; nothing else changes. To turn it on, macOS wants you to allow OSAT under Accessibility. OSAT asks only when you press the button.'}
        words="accessibility allow paste move windows"
      >
        {!granted && <button className="outline-button" type="button" onClick={() => bridge.askAccess().then(() => setTimeout(look, 1500), () => {})}><LockSimple /> Allow in Accessibility…</button>}
      </Row>
    </Group>
  )
}

export function ClipboardPage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app, everything you copy is kept on this Mac, searchable, with pins for what you paste often.">
      {({ bridge, settings, board, setBoard, save, showUndo, setMessage }) => (
        <>
          <Group title="History">
            <Row title="Keep the last" hint="The newest copies stay; older ones go quietly. A pinned copy stays whatever the limits say." words="copies limit count how many">
              <Select label="How many copies to keep" value={settings.clipboard.items} onChange={(items) => save({ clipboard: { items: Number(items) } })} options={ITEM_CHOICES.map((count) => [count, `${count} copies`])} />
            </Row>
            <Row title="Keep a copy for" hint="Older copies are forgotten after this long." words="days age how long history">
              <Select label="How long to keep a copy" value={settings.clipboard.days} onChange={(days) => save({ clipboard: { days: Number(days) } })} options={DAY_CHOICES.map((days) => [days, DAYS[days]])} />
            </Row>
            <Row title="Pause" hint={board?.paused ? 'Not keeping what you copy. Turn it off to start again.' : 'Stop keeping what you copy for a while.'} words="stop keep history">
              <Switch label="Pause the clipboard history" checked={board?.paused === true} onChange={(paused) => bridge.pauseClipboard(paused).then((now) => setBoard({ paused: now }), (error) => setMessage(explain(error)))} />
            </Row>
          </Group>
          <Group title="Privacy" note="Search it with v (or type “clipboard”) in the quick bar, paste from it, or drag a copy into another app.">
            <Row title="Password managers" hint="Copies from password managers are never kept, and neither is anything OSAT copies for itself." words="1password bitwarden concealed secret" />
            <Row title="Add to a node" hint="Offer to add a copied email address or phone number to its node, once, when that node already exists." words="offer jordan customer contact">
              <Switch label="Offer to add a copied email address or phone number to its node" checked={settings.clipboard.offers !== false} onChange={(offers) => save({ clipboard: { offers } })} />
            </Row>
          </Group>
          <Group title="Clear">
            <Row title="Clear the history" hint="It goes at once, and Undo is there for a few seconds." words="delete forget erase">
              <button className="outline-button" type="button" onClick={async () => {
                try {
                  const token = await bridge.clearClipboard()
                  showUndo('Cleared the clipboard history', token && token !== 'empty' ? () => bridge.undoClip(token) : undefined)
                } catch (error) { setMessage(explain(error)) }
              }}>Clear the history</button>
            </Row>
          </Group>
          <Permission />
        </>
      )}
    </LauncherPage>
  )
}

/* ---- Quick links -------------------------------------------------------------------------------------------------- */

export function QuickLinksPage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app, a quick link opens in your own browser from the quick bar, the line or a key.">
      {({ settings, save, showUndo }) => <QuickLinks settings={settings} save={save} showUndo={showUndo} />}
    </LauncherPage>
  )
}

function QuickLinks({ settings, save, showUndo }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [word, setWord] = useState('')
  const { key, word: wordHolder } = holders(settings)
  const w = word.trim().toLowerCase()
  const taken = w ? holderOf(settings, { word: w }) : null
  const ready = validAddress(url) && (!w || (validKeyword(w) && !taken))
  const edit = (id, patch) => save({ links: settings.links.map((link) => (link.id === id ? { ...link, ...patch } : link)) })

  function add(event) {
    event.preventDefault()
    if (!ready) return
    const link = { id: `link-${Date.now().toString(36)}`, name: name.trim() || hostOf(url), url: url.trim(), keyword: w || null, hotkey: null, on: true }
    save({ links: [...settings.links, link] })
    setName(''); setUrl(''); setWord('')
  }
  function remove(link) {
    const before = settings.links
    save({ links: before.filter((other) => other.id !== link.id) })
    showUndo(`Took off “${link.name}”`, () => save({ links: before }))
  }

  return (
    <>
      <Group title="Your links" note="An address with {query} in it searches for the words you type after its word: g best CRMs. Without {query}, its word just opens it.">
        {settings.links.map((link) => (
          <Row key={link.id} title={link.name} hint={link.url} words={link.keyword || ''}>
            <div className="setting-controls">
              <WordField value={link.keyword} name={link.name} holder={wordHolder(`link:${link.id}`)} onSave={(keyword) => edit(link.id, { keyword })} />
              <KeyRecorder value={link.hotkey} name={link.name} holder={key(`link:${link.id}`)} sends={settings.hyper.sends} onSet={(hotkey) => edit(link.id, { hotkey })} />
              <Switch label={`Use ${link.name}`} checked={link.on !== false} onChange={(on) => edit(link.id, { on })} />
              <button type="button" className="icon-plain" aria-label={`Take off ${link.name}`} onClick={() => remove(link)}><X weight="bold" /></button>
            </div>
          </Row>
        ))}
        {settings.links.length === 0 && <Row title="No quick links yet" hint="Add one below." />}
      </Group>
      <Group title="Add a quick link">
        <Row title="A new quick link" hint="Its name, its address (http or https), and a short word to type." stacked words="add new github google jira">
          <form className="setting-form" onSubmit={add}>
            <label><span>Name</span><input value={name} maxLength={40} placeholder="GitHub" aria-label="Name of the quick link" onChange={(event) => setName(event.target.value)} /></label>
            <label><span>Link</span><input value={url} maxLength={300} placeholder="https://github.com/search?q={query}" spellCheck={false} aria-label="Address of the quick link" onChange={(event) => setUrl(event.target.value)} /></label>
            <label><span>Word</span><input value={word} maxLength={12} placeholder="gh" spellCheck={false} aria-label="Word for the quick link" onChange={(event) => setWord(event.target.value)} /></label>
            <button className="outline-button" type="submit" disabled={!ready}><Plus /> Add</button>
          </form>
          {taken && <small className="setting-inline" role="status">“{w}” is {taken}’s word already. Pick another.</small>}
        </Row>
      </Group>
    </>
  )
}

/* ---- Window layouts ----------------------------------------------------------------------------------------------- */

export function WindowLayoutsPage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app, a layout snaps the window you were in to a half, a third or a corner.">
      {({ settings, save, status }) => {
        const { key } = holders(settings)
        return (
          <>
            <Group title="Keys" note="Or type “left half” in the quick bar (or w and a word), and the window you were in moves there.">
              <Row title="Move the window I’m in with keys" hint="Keys that work from any app are off until you turn them on." words="hotkeys global any app">
                <Switch label="Use keys to move the window I’m in, from any app" checked={settings.windows.on} onChange={(on) => save({ windows: { on } })} />
              </Row>
            </Group>
            {settings.windows.on && (
              <Group title="Layouts">
                {LAYOUTS.map((layout) => (
                  <Row key={layout.id} title={layout.label} hint={layout.id === 'restore' ? 'Where the window was before OSAT moved it' : ''} words={layout.words || ''}>
                    <KeyRecorder value={settings.windows.hotkeys[layout.id]} name={layout.label} holder={key(`snap:${layout.id}`)} sends={settings.hyper.sends} failed={status?.keysFailed?.includes(`snap:${layout.id}`)} onSet={(hotkey) => save({ windows: { hotkeys: { [layout.id]: hotkey } } })} />
                  </Row>
                ))}
              </Group>
            )}
            <Permission />
          </>
        )
      }}
    </LauncherPage>
  )
}

/* ---- The ring ----------------------------------------------------------------------------------------------------- */

export function RingPage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app, the ring opens around your pointer from a key, or with ⌘ and a middle-click.">
      {({ settings, save, status }) => {
        const { key } = holders(settings)
        const chosen = ringItems(settings.ring.items).map((item) => item.id)
        const rest = RING_ITEMS.filter((item) => !chosen.includes(item.id))
        const put = (items) => save({ ring: { items } })
        const move = (index, by) => {
          const next = [...chosen]
          ;[next[index], next[index + by]] = [next[index + by], next[index]]
          put(next)
        }
        return (
          <>
            <Group title="The ring" note="Press its key from any app, or hold ⌘ and middle-click anywhere in OSAT. Over other apps, ⌘ and middle-click would need a helper that watches every click, so the key does that job.">
              <Row title="Use the ring" hint="Quick tools in a circle around your pointer.">
                <Switch label="Use the ring" checked={settings.ring.on} onChange={(on) => save({ ring: { on } })} />
              </Row>
              {settings.ring.on && (
                <Row title="Its key" hint="Works from any app.">
                  <KeyRecorder value={settings.ring.hotkey} name="the ring" holder={key('ring')} sends={settings.hyper.sends} failed={status?.keysFailed?.includes('ring')} onSet={(hotkey) => save({ ring: { hotkey } })} />
                </Row>
              )}
            </Group>
            {settings.ring.on && (
              <>
                <Group title="What it holds" note={`Up to ${MAX_RING}, the first at the top and then clockwise. The layouts move the window you were in, so they only show over other apps.`}>
                  {chosen.map((id, index) => {
                    const item = RING_ITEMS.find((entry) => entry.id === id)
                    return (
                      <Row key={id} title={item.label} hint={index === 0 ? 'At the top' : ''} words="tool order">
                        <div className="setting-controls">
                          <button type="button" className="icon-plain" aria-label={`Move ${item.label} earlier`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp weight="bold" /></button>
                          <button type="button" className="icon-plain" aria-label={`Move ${item.label} later`} disabled={index === chosen.length - 1} onClick={() => move(index, 1)}><ArrowDown weight="bold" /></button>
                          <button type="button" className="icon-plain" aria-label={`Take ${item.label} off the ring`} onClick={() => put(chosen.filter((other) => other !== id))}><X weight="bold" /></button>
                        </div>
                      </Row>
                    )
                  })}
                  {chosen.length === 0 && <Row title="Nothing on the ring" hint="Add a tool below." />}
                  {rest.length > 0 && chosen.length < MAX_RING && (
                    <Row title="Add a tool" hint="It goes last.">
                      <Select label="Add a tool to the ring" value="" onChange={(id) => id && put([...chosen, id])} options={[['', 'Choose…'], ...rest.map((item) => [item.id, item.label])]} />
                    </Row>
                  )}
                </Group>
                <Group>
                  <Row title="Back to the usual tools" hint="Quick bar, Clipboard, New sticky, Ask, The desk, and three window layouts.">
                    <button className="outline-button" type="button" onClick={() => put(null)}>Reset the ring</button>
                  </Row>
                </Group>
              </>
            )}
          </>
        )
      }}
    </LauncherPage>
  )
}
