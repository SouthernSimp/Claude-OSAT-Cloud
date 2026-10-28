import { useEffect, useRef, useState } from 'react'
import { ArrowClockwise, ArrowLeft, ArrowRight, Check, Globe, House, Key, ListChecks, MagnifyingGlass, Plus, Record, Scissors, X } from '@phosphor-icons/react'

import { createNote, excerpt, isActiveNote } from '../notes-model.js'
import { SEARCHES, clipMarkdown, searchUrl, toAddress } from './address.js'
import { SkillBar, SkillList, useSkills } from './Skills.jsx'

// Which search and which home page, kept on this Mac only.
const PICKS_KEY = 'osat.browser.picks.v1'
const readPicks = () => { try { return { search: 'duckduckgo', home: '', ...JSON.parse(localStorage.getItem(PICKS_KEY) || '{}') } } catch { return { search: 'duckduckgo', home: '' } } }
const keepPicks = (picks) => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)) } catch { /* the next open starts with DuckDuckGo */ } }

/* The page itself is a native Chromium view the Mac app lays over .browser-page.
   This room draws the tabs, the address bar and the clipper around it. */
export function BrowserView({ workspace, commit, navigate, covered, command, frame }) {
  const bridge = window.osatBrowser
  const [state, setState] = useState({ tabs: [], active: null })
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [picks, setPicks] = useState(readPicks)
  const [homeDraft, setHomeDraft] = useState(picks.home)
  // Phase 102: ⌘\ or the key button. null, or { site, locked, logins } for the little panel under the bar.
  const [fill, setFill] = useState(null)
  const [master, setMaster] = useState('')
  const passwords = window.osatPasswords
  const pick = (next) => { const merged = { ...picks, ...next }; setPicks(merged); keepPicks(merged) }
  const skills = useSkills((text) => setToast({ tone: 'bad', text }))
  const page = useRef(null)
  const field = useRef(null)
  const tab = state.tabs.find((item) => item.id === state.active) || null
  const blank = !tab || !tab.url || tab.url === 'about:blank'
  const clips = workspace.notes.filter((note) => isActiveNote(note) && note.tags?.includes('clip'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8)

  useEffect(() => {
    if (!bridge) return undefined
    bridge.state().then(setState).catch(() => {})
    return bridge.onState(setState)
  }, [bridge])

  useEffect(() => {
    if (!editing) setAddress(blank ? '' : tab.url)
  }, [tab?.url, editing, blank])

  /* Menus in the top bar drop over the page; the native view would hide them. */
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setMenuOpen(root.dataset.menu === 'open')
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-menu'] })
    return () => observer.disconnect()
  }, [])

  /* Keep the native page exactly over the page area; hide it whenever something covers the room. */
  useEffect(() => {
    if (!bridge) return undefined
    const node = page.current
    const place = () => {
      if (!node || covered || menuOpen || blank) return bridge.place(null)
      const zoom = window.outerWidth / window.innerWidth || 1
      const rect = node.getBoundingClientRect()
      bridge.place({ x: rect.left * zoom, y: rect.top * zoom, width: rect.width * zoom, height: rect.height * zoom })
    }
    place()
    const observer = new ResizeObserver(place)
    if (node) observer.observe(node)
    window.addEventListener('resize', place)
    // The pop-out opens slightly scaled down; measure again once it has settled.
    const popout = node?.closest('.popout')
    popout?.addEventListener('animationend', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      popout?.removeEventListener('animationend', place)
      bridge.place(null)
    }
  }, [bridge, covered, menuOpen, blank, state.active, frame])

  useEffect(() => {
    if (!bridge || !command?.at) return
    if (command.action === 'new-tab') newTab()
    if (command.action === 'fill-password') openFill()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.at])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function run(action) {
    try {
      await action()
    } catch (error) {
      setToast({ tone: 'bad', text: String(error?.message || 'That did not work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  function go(event) {
    event.preventDefault()
    const url = toAddress(address, searchUrl(picks.search))
    if (!url) return
    setEditing(false)
    field.current?.blur()
    run(() => (tab ? bridge.navigate(url) : bridge.open(url)))
  }

  function goHome() {
    if (picks.home) run(() => (tab ? bridge.navigate(picks.home) : bridge.open(picks.home)))
  }

  function saveHome(event) {
    event.preventDefault()
    const home = toAddress(homeDraft, searchUrl(picks.search))
    pick({ home })
    setHomeDraft(home)
  }

  function newTab() {
    run(async () => {
      await bridge.open('about:blank')
      requestAnimationFrame(() => field.current?.focus())
    })
  }

  /* A saved password for the page in front. Main works out the site from its own tab and hands the password straight to the
     page; this room only ever sees titles and usernames. One login fills at once; several are offered; locked asks here. */
  function openFill() {
    if (!passwords || blank) return
    run(async () => {
      const found = await passwords.logins()
      if (!found.site) { setFill(null); setToast({ tone: 'bad', text: 'Saved passwords fill only on secure (https) pages.' }); return }
      if (found.locked) { setMaster(''); setFill(found); return }
      if (found.logins.length === 1) return fillWith(found.logins[0], found.site)
      if (!found.logins.length) { setFill(null); setToast({ tone: 'bad', text: `No saved password for ${found.site}. Add one in Passwords.` }); return }
      setFill(found)
    })
  }

  function fillWith(login, site) {
    run(async () => {
      setFill(null)
      await passwords.fill(login.id)
      setToast({ tone: 'good', text: `Filled ${login.username || login.title} on ${site}` })
    })
  }

  function unlockToFill(event) {
    event.preventDefault()
    run(async () => {
      await passwords.unlock(master)
      setMaster('')
      openFill()
    })
  }

  function clip() {
    run(async () => {
      const page = await bridge.clip()
      const { title, markdown } = clipMarkdown(page)
      let note
      commit((current) => {
        const result = createNote(current, { title, markdown })
        note = result.note
        return result.state
      })
      setToast({ tone: 'good', text: page.selection.trim() ? 'Clipped your selection to Notes' : 'Clipped this page to Notes', noteId: note?.id })
    })
  }

  if (!bridge) {
    return (
      <section className="tool-unavailable">
        <Globe weight="duotone" />
        <h2>The browser lives in the OSAT Mac app.</h2>
        <p>Web pages can’t load inside a browser tab like this one. Open OSAT on your Mac to browse, and to clip pages straight into Notes.</p>
      </section>
    )
  }

  return (
    <section className="browser">
      <header className="browser-bar">
        <nav className="browser-tabs" aria-label="Browser tabs">
          {state.tabs.map((item) => (
            <div key={item.id} className={`browser-tab ${item.id === state.active ? 'is-active' : ''}`}>
              <button type="button" className="browser-tab-main" aria-current={item.id === state.active ? 'page' : undefined} onClick={() => run(() => bridge.activate(item.id))} title={item.title}>
                <Globe />
                <span>{item.url === 'about:blank' ? 'New tab' : item.title || item.url}</span>
              </button>
              <button type="button" className="browser-tab-close" aria-label={`Close ${item.title || 'tab'}`} onClick={() => run(() => bridge.close(item.id))}><X /></button>
            </div>
          ))}
          <button type="button" className="browser-new" aria-label="New tab" title="New tab (⌘T)" onClick={newTab}><Plus weight="bold" /></button>
        </nav>
        <div className="browser-row">
          <button type="button" className="browser-icon" aria-label="Back" disabled={!tab?.canBack} onClick={() => run(() => bridge.back())}><ArrowLeft /></button>
          <button type="button" className="browser-icon" aria-label="Forward" disabled={!tab?.canForward} onClick={() => run(() => bridge.forward())}><ArrowRight /></button>
          {picks.home && <button type="button" className="browser-icon" aria-label="Home" title={picks.home} onClick={goHome}><House /></button>}
          <button type="button" className="browser-icon" aria-label={tab?.loading ? 'Stop loading' : 'Reload'} disabled={blank} onClick={() => run(() => (tab?.loading ? bridge.stop() : bridge.reload()))}>
            {tab?.loading ? <X /> : <ArrowClockwise />}
          </button>
          <form className="browser-address" onSubmit={go}>
            <MagnifyingGlass />
            <label className="visually-hidden" htmlFor="browser-address">Address or search</label>
            <input
              id="browser-address"
              ref={field}
              value={address}
              placeholder="Search the web or type an address"
              spellCheck={false}
              autoComplete="off"
              onFocus={(event) => { setEditing(true); event.target.select() }}
              onBlur={() => setEditing(false)}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { setEditing(false); event.currentTarget.blur() } }}
            />
            {tab?.loading && <i className="browser-loading" aria-hidden="true" />}
          </form>
          <button type="button" className="browser-clip" disabled={blank} onClick={clip} title="Save the selection, or this page, as a note">
            <Scissors /> <span>Clip to OSAT</span>
          </button>
          {skills.available && (
            <button type="button" className="browser-skill" disabled={blank || Boolean(skills.state.recording || skills.state.running)} onClick={skills.record} title="Do something once on this page; OSAT writes it down so you can run it again">
              <Record weight="fill" /> <span>Record a skill</span>
            </button>
          )}
          {passwords && (
            <button type="button" className="browser-icon" aria-label="Fill a saved password" title="Fill a saved password (⌘\)" disabled={blank} onClick={openFill}><Key /></button>
          )}
          {skills.available && (
            <button type="button" className="browser-skill is-quiet" aria-label="Your skills" title="Your skills" onClick={newTab}><ListChecks /></button>
          )}
        </div>
        <SkillBar skills={skills} />
        {fill && (
          <div className="browser-fill" onKeyDown={(event) => { if (event.key === 'Escape') setFill(null) }}>
            <Key aria-hidden="true" />
            {fill.locked ? (
              <form onSubmit={unlockToFill}>
                <label htmlFor="browser-master">Unlock Passwords to fill {fill.site}</label>
                <input id="browser-master" type="password" autoFocus autoComplete="off" value={master} onChange={(event) => setMaster(event.target.value)} placeholder="Master password" />
                <button type="submit" className="text-button" disabled={!master}>Unlock</button>
              </form>
            ) : (
              <>
                <span>Fill on {fill.site}:</span>
                {fill.logins.map((login) => (
                  <button key={login.id} type="button" autoFocus={login === fill.logins[0]} onClick={() => fillWith(login, fill.site)}>
                    <strong>{login.title}</strong>{login.username && <span>{login.username}</span>}
                  </button>
                ))}
              </>
            )}
            <button type="button" className="browser-icon" aria-label="Close" onClick={() => setFill(null)}><X /></button>
          </div>
        )}
        {toast && (
          <p className={`browser-toast is-${toast.tone}`} role="status">
            {toast.tone === 'good' && <Check weight="bold" />}
            {toast.text}
            {toast.noteId && <button type="button" onClick={() => navigate('Notes', { noteId: toast.noteId })}>Open</button>}
            {toast.undo && <button type="button" onClick={toast.undo}>Undo</button>}
          </p>
        )}
      </header>

      <div className="browser-page" ref={page}>
        {blank && (
          <div className="browser-start">
            <Globe weight="duotone" />
            <h2>Where to?</h2>
            <p>Search or type an address above. Pages open in their own private session, and nothing here reaches your notes unless you clip it.</p>
            <div className="browser-picks">
              <label>Search with
                <select value={picks.search} onChange={(event) => pick({ search: event.target.value })}>
                  {SEARCHES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <form onSubmit={saveHome}>
                <label htmlFor="browser-home">Home page</label>
                <input id="browser-home" value={homeDraft} placeholder="fortispay.com" spellCheck={false} autoComplete="off" onChange={(event) => setHomeDraft(event.target.value)} />
                <button type="submit" className="text-button" disabled={homeDraft.trim() === picks.home}>{homeDraft.trim() ? 'Save' : 'Clear'}</button>
                {picks.home && <button type="button" className="text-button" onClick={goHome}>Open</button>}
              </form>
            </div>
            <SkillList skills={skills} onRemoved={(gone) => setToast({ tone: 'good', text: `Deleted “${gone.name}”`, undo: () => { skills.restore(gone); setToast(null) } })} />
            {clips.length > 0 && (
              <div className="browser-clips">
                <h3>Clipped lately</h3>
                {clips.map((note) => {
                  const source = note.markdown.match(/\]\((https?:\/\/[^)\s]+)\)/)?.[1]
                  return (
                    <div key={note.id} className="browser-clip-row">
                      <button type="button" onClick={() => navigate('Notes', { noteId: note.id })}>
                        <strong>{note.title}</strong>
                        <span>{excerpt(note.markdown, 90)}</span>
                      </button>
                      {source && <button type="button" className="browser-reopen" onClick={() => run(() => (tab ? bridge.navigate(source) : bridge.open(source)))}>Open page</button>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
