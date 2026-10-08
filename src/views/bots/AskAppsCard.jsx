import { useState } from 'react'
import { ArrowCounterClockwise, ArrowsClockwise, Check, DownloadSimple, LockSimple, Plus, PuzzlePiece } from '@phosphor-icons/react'

import { formatRelativeTime } from '../../lib/ui.js'
import { Choice, Switch } from '../settings/parts.jsx'
import '../../styles/bots-ask-apps.css'

const cleanError = (error) => String(error?.message || error || 'That didn’t work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const KINDS = [['http', 'A web address'], ['command', 'A command on this Mac']]
const things = (count) => (count === 1 ? '1 thing it can do' : `${count} things it can do`)

/* Apps OSAT can use (Phase 48): the apps Claude uses (Google Calendar, Gmail, Notion…), each off
   until Nate turns it on. Main keeps the list (desktop/bots/ask-apps.cjs); keys and a command's
   settings go to the Keychain and never come back here. `apps` arrives with Bots' status. */
export function AskAppsCard({ apps = [], offline = false }) {
  const bridge = typeof window === 'undefined' ? null : window.osatAskApps
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showing, setShowing] = useState(null) // the app whose list of things shows
  const [removed, setRemoved] = useState(null) // { name }, for Undo
  const [form, setForm] = useState(null) // { kind, name, url, key, command } while adding
  const [offers, setOffers] = useState(null) // what Claude Desktop has, while importing
  const [picked, setPicked] = useState(() => new Set())
  if (!bridge) return null

  const act = async (work, done) => {
    setBusy(true)
    try {
      const result = await work()
      setMessage(typeof done === 'function' ? done(result) : done ? { ok: true, text: done } : null)
      return result
    } catch (error) {
      setMessage({ ok: false, text: cleanError(error) })
      return null
    } finally {
      setBusy(false)
    }
  }

  const add = async (event) => {
    event.preventDefault()
    const input = form.kind === 'http'
      ? { kind: 'http', name: form.name, url: form.url, header: form.key }
      : { kind: 'command', name: form.name, command: form.command }
    const row = await act(() => bridge.add(input), (made) => (made.error
      ? { ok: false, text: `${made.name} was added, but ${made.error.charAt(0).toLowerCase()}${made.error.slice(1)}` }
      : { ok: true, text: made.tools === null ? `${made.name} was added.` : `${made.name} was added. ${things(made.tools)}.` }))
    if (row) setForm(null)
  }

  const startImport = async () => {
    setForm(null)
    const found = await act(() => bridge.claudeConfig())
    if (!found) return
    if (!found.apps.length) return setMessage({ ok: false, text: 'Claude Desktop has no apps OSAT could use.' })
    setOffers(found.apps)
    setPicked(new Set())
  }

  const importPicked = async () => {
    const result = await act(() => bridge.import([...picked]), ({ added, skipped }) => (skipped.length
      ? { ok: false, text: `${skipped.map((item) => `${item.name}: ${item.why}`).join(' ')}` }
      : { ok: true, text: `${added.length === 1 ? `${added[0].name} was` : `${added.length} apps were`} added. Each stays off until you turn it on.` }))
    if (result) setOffers(null)
  }

  const remove = (app) => act(async () => {
    await bridge.remove(app.id)
    setRemoved({ name: app.name })
  })

  const undo = () => act(async () => {
    await bridge.undoRemove()
    setRemoved(null)
  })

  const pick = (name) => setPicked((now) => {
    const next = new Set(now)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })

  return (
    <section className="content-card bots-card ask-apps-card">
      <p className="eyebrow">APPS</p>
      <h2>Apps OSAT can use</h2>
      <p>Ask can also read your Google Calendar, Gmail, Notion and other apps you connect here: the same ones Claude uses. Each one stays off until you turn it on.</p>
      <p className="bots-privacy">
        <LockSimple aria-hidden="true" />
        When one is on, Ask can use it while you ask. Anything that changes something in that app asks you first.
      </p>
      {offline && <p className="bots-warning" role="status">Offline: apps OSAT uses wait until you’re back online.</p>}

      {apps.length > 0 && (
        <ul className="ask-apps" aria-label="Apps OSAT can use">
          {apps.map((app) => (
            <li key={app.id}>
              <PuzzlePiece aria-hidden="true" />
              <span className="ask-app-name">
                <b>{app.name}</b>
                <code>{app.where}</code>
                {app.error
                  ? <small className="ask-app-error">{app.error}</small>
                  : app.tools === null
                    ? <small>{app.on ? 'Not checked yet.' : 'Off. Turn it on to see what it can do.'}</small>
                    : (
                      <span className="ask-app-meta">
                        <button className="text-button ask-app-count" type="button" aria-expanded={showing === app.id} onClick={() => setShowing(showing === app.id ? null : app.id)}>
                          {app.tools ? things(app.tools) : 'Nothing it can do yet'}
                        </button>
                        {app.checkedAt && <small>· checked {formatRelativeTime(app.checkedAt)}</small>}
                      </span>
                    )}
              </span>
              <Switch checked={app.on} disabled={busy} label={`Let Ask use ${app.name}`} onChange={(on) => act(() => bridge.toggle(app.id, on))} />
              <span className="ask-app-actions">
                <button className="text-button" type="button" disabled={busy || offline || !app.on} onClick={() => act(() => bridge.check(app.id))}><ArrowsClockwise /> Check</button>
                <button className="text-button" type="button" disabled={busy} onClick={() => remove(app)}>Remove</button>
              </span>
              {showing === app.id && app.toolNames?.length > 0 && (
                <ul className="ask-app-tools" aria-label={`What ${app.name} can do`}>
                  {app.toolNames.map((name) => <li key={name}>{name}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {!apps.length && !form && !offers && <p className="ai-note">No apps yet. Add one, or bring over the ones Claude Desktop uses.</p>}
      {removed && (
        <p className="bots-message ask-apps-removed" role="status">
          <Check /> {removed.name} was removed.
          <button className="text-button" type="button" disabled={busy} onClick={undo}><ArrowCounterClockwise /> Undo</button>
        </p>
      )}

      {form && (
        <form className="ask-apps-form" onSubmit={add}>
          <Choice label="How OSAT reaches it" value={form.kind} options={KINDS} onChange={(kind) => setForm({ ...form, kind })} />
          <label><span>Name</span><input value={form.name} maxLength={60} placeholder="Optional, like Notion" onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          {form.kind === 'http' ? (
            <>
              <label><span>Address</span><input value={form.url} spellCheck={false} placeholder="https://mcp.notion.com/mcp" onChange={(event) => setForm({ ...form, url: event.target.value })} /></label>
              <label><span>Key</span><input type="password" value={form.key} autoComplete="off" spellCheck={false} placeholder="Only if it needs one" onChange={(event) => setForm({ ...form, key: event.target.value })} /></label>
            </>
          ) : (
            <>
              <label><span>Command</span><input className="ask-apps-command" value={form.command} spellCheck={false} placeholder="npx -y @notionhq/notion-mcp-server" onChange={(event) => setForm({ ...form, command: event.target.value })} /></label>
              <p className="ai-note">OSAT runs this command on your Mac when Ask needs the app, and stops it after 10 quiet minutes. A key it needs can go in front, like NOTION_TOKEN=… npx …; OSAT keeps it in your Keychain.</p>
            </>
          )}
          <div className="button-row">
            <button className="primary-button" type="submit" disabled={busy || !(form.kind === 'http' ? form.url.trim() : form.command.trim())}><Plus /> {busy ? 'Adding…' : 'Add'}</button>
            <button className="text-button" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {offers && (
        <div className="ask-apps-import">
          <strong>From Claude Desktop</strong>
          <p className="ai-note">Tick the ones to bring over. Each comes in off, and runs only once you turn it on. Keys go to your Keychain.</p>
          <ul>
            {offers.map((item) => (
              <li key={item.name}>
                <label>
                  <input type="checkbox" checked={item.added || picked.has(item.name)} disabled={item.added} onChange={() => pick(item.name)} />
                  <span>
                    <b>{item.name}</b>{item.added && <small> · already here</small>}{item.withKey && !item.added && <small> · with a key</small>}
                    <code>{item.where}</code>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="button-row">
            <button className="primary-button" type="button" disabled={busy || !picked.size} onClick={importPicked}><Plus /> Add {picked.size > 1 ? `these ${picked.size}` : 'it'}</button>
            <button className="text-button" type="button" onClick={() => setOffers(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!form && !offers && (
        <div className="button-row">
          <button className="primary-button" type="button" disabled={busy} onClick={() => { setMessage(null); setForm({ kind: 'http', name: '', url: '', key: '', command: '' }) }}><Plus /> Add an app</button>
          <button className="outline-button" type="button" disabled={busy} onClick={startImport}><DownloadSimple /> Import from Claude Desktop</button>
        </div>
      )}
      {message && <p className={message.ok ? 'bots-message' : 'bots-warning'} role="status">{message.ok && <Check />} {message.text}</p>}
    </section>
  )
}
