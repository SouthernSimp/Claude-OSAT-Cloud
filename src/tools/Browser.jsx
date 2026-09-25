import { useEffect, useRef, useState } from 'react'
import { ArrowClockwise, ArrowLeft, ArrowRight, Check, Globe, MagnifyingGlass, Plus, Scissors, X } from '@phosphor-icons/react'

import { createNote, excerpt, isActiveNote } from '../notes-model.js'
import { clipMarkdown, toAddress } from './address.js'

/* The page itself is a native Chromium view the Mac app lays over .browser-page.
   This room draws the tabs, the address bar and the clipper around it. */
export function BrowserView({ workspace, commit, navigate, covered, command }) {
  const bridge = window.osatBrowser
  const [state, setState] = useState({ tabs: [], active: null })
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
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
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      bridge.place(null)
    }
  }, [bridge, covered, menuOpen, blank, state.active])

  useEffect(() => {
    if (!bridge || !command?.at) return
    if (command.action === 'new-tab') newTab()
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
    const url = toAddress(address)
    if (!url) return
    setEditing(false)
    field.current?.blur()
    run(() => (tab ? bridge.navigate(url) : bridge.open(url)))
  }

  function newTab() {
    run(async () => {
      await bridge.open('about:blank')
      requestAnimationFrame(() => field.current?.focus())
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
        <p>Web pages can’t load inside a browser tab like this one. Open OSAT Field on your Mac to browse, and to clip pages straight into Notes.</p>
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
            <Scissors /> Clip to OSAT
          </button>
        </div>
        {toast && (
          <p className={`browser-toast is-${toast.tone}`} role="status">
            {toast.tone === 'good' && <Check weight="bold" />}
            {toast.text}
            {toast.noteId && <button type="button" onClick={() => navigate('Notes', { noteId: toast.noteId })}>Open</button>}
          </p>
        )}
      </header>

      <div className="browser-page" ref={page}>
        {blank && (
          <div className="browser-start">
            <Globe weight="duotone" />
            <h2>Where to?</h2>
            <p>Search or type an address above. Pages open in their own private session, and nothing here reaches your notes unless you clip it.</p>
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
