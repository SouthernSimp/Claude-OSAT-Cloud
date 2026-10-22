import { useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, ArrowsClockwise, CaretRight, Check, DownloadSimple, LockSimple, Plus, PuzzlePiece, SignIn, X } from '@phosphor-icons/react'

import { cleanError } from '../../assistant/useAi.js'
import { formatRelativeTime } from '../../lib/ui.js'
import { Choice, Switch } from '../settings/parts.jsx'
import '../../styles/bots-ask-apps.css'

const KINDS = [['http', 'A web address'], ['command', 'A command on this Mac']]
const things = (count) => (count === 1 ? '1 thing it can do' : `${count} things it can do`)
// Apps whose own servers sign in in the browser (Phase 71b): one tap adds and signs in. Each was checked on Oct 22
// 2026 (Phase 88) to answer as an MCP server and to let OSAT register itself; Slack, HubSpot, Asana, Box and GitHub
// don't (they want OSAT registered by hand), so they aren't here.
const SIGN_IN_APPS = [
  ['Granola', 'https://mcp.granola.ai/mcp', 'Meeting notes and follow-ups'],
  ['Notion', 'https://mcp.notion.com/mcp', 'Pages and notes'],
  ['Airtable', 'https://mcp.airtable.com/mcp', 'Bases and records'],
  ['monday.com', 'https://mcp.monday.com/mcp', 'Boards and projects'],
  ['ClickUp', 'https://mcp.clickup.com/mcp', 'Tasks and docs'],
  ['Todoist', 'https://ai.todoist.net/mcp', 'Tasks and projects'],
  ['Linear', 'https://mcp.linear.app/mcp', 'Issues and projects'],
  ['Jira and Confluence', 'https://mcp.atlassian.com/v1/mcp', 'Atlassian work and pages'],
  ['Calendly', 'https://mcp.calendly.com', 'Bookings and meeting links'],
  ['Stripe', 'https://mcp.stripe.com', 'Payments and invoices'],
  ['Square', 'https://mcp.squareup.com/mcp', 'Sales, orders and customers'],
  ['PayPal', 'https://mcp.paypal.com/mcp', 'Invoices and payments'],
  ['Canva', 'https://mcp.canva.com/mcp', 'Designs'],
  ['Figma', 'https://mcp.figma.com/mcp', 'Design files'],
  ['Intercom', 'https://mcp.intercom.com/mcp', 'Customer conversations'],
  ['Webflow', 'https://mcp.webflow.com/mcp', 'Your website'],
  ['Wix', 'https://mcp.wix.com/mcp', 'Your website and store'],
  ['Zapier', 'https://mcp.zapier.com/api/mcp/mcp', 'Thousands more apps'],
]
const sameAddress = (a, b) => { try { return new URL(a).href === new URL(b).href } catch { return false } }

/* Apps OSAT can use (Phase 48): the apps Claude uses (Google Calendar, Gmail, Notion…), each off
   until Nate turns it on. Main keeps the list (desktop/bots/ask-apps.cjs); keys and a command's
   settings go to the Keychain and never come back here. `apps` arrives with Bots' status. */
export function AskAppsCard({ apps = [], offline = false }) {
  const bridge = typeof window === 'undefined' ? null : window.osatAskApps
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showing, setShowing] = useState(null) // the app whose details show
  const [adding, setAdding] = useState(false)
  const connectButton = useRef(null)
  const picker = useRef(null)
  const [removed, setRemoved] = useState(null) // { name }, for Undo
  const [form, setForm] = useState(null) // { kind, name, url, key, command } while adding
  const [offers, setOffers] = useState(null) // what Claude Desktop has, while importing
  const [picked, setPicked] = useState(() => new Set())
  const [signing, setSigning] = useState('') // the app's name while its sign-in page is open in the browser
  const [find, setFind] = useState('')
  useEffect(() => { if (adding) picker.current?.focus() }, [adding])
  if (!bridge) return null

  const shown = SIGN_IN_APPS.filter(([name, , what]) => `${name} ${what}`.toLowerCase().includes(find.trim().toLowerCase()))

  const closeAdd = () => { setAdding(false); setForm(null); setOffers(null); setFind(''); connectButton.current?.focus() }

  const act = async (work, done) => {
    setBusy(true)
    setMessage(null)
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
      ? { ok: false, text: `${made.name} was added. ${made.error}` }
      : { ok: true, text: made.tools === null ? `${made.name} was added.` : `${made.name} was added. ${things(made.tools)}.` }))
    if (row) { setForm(null); setAdding(false); connectButton.current?.focus() }
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
    const result = await act(() => bridge.import([...picked]), ({ added, skipped }) => {
      const came = added.length ? `${added.length === 1 ? `${added[0].name} was` : `${added.length} apps were`} added. ` : ''
      return skipped.length
        ? { ok: false, text: `${came}${skipped.map((item) => `${item.name}: ${item.why}`).join(' ')}` }
        : { ok: true, text: `${came}Each stays off until you turn it on.` }
    })
    if (result) { setOffers(null); setAdding(false); connectButton.current?.focus() }
  }

  const signInTo = (name, id) => {
    setSigning(name)
    return act(async () => bridge.signIn(id ?? (await bridge.add({ kind: 'http', name, url: SIGN_IN_APPS.find(([label]) => label === name)[1] })).id),
      (row) => {
        if (row.error) return { ok: false, text: row.error }
        setAdding(false)
        connectButton.current?.focus()
        return { ok: true, text: `Signed in to ${row.name}.${row.on ? '' : ' Turn it on when you want OSAT to use it.'}` }
      })
      .finally(() => setSigning(''))
  }

  const remove = (app) => act(async () => {
    await bridge.remove(app.id)
    setRemoved({ name: app.name })
    setShowing(null)
    connectButton.current?.focus()
  })

  const undo = () => act(async () => {
    await bridge.undoRemove()
    setRemoved(null)
    connectButton.current?.focus()
  })

  const pick = (name) => setPicked((now) => {
    const next = new Set(now)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })

  return (
    <section className="ask-apps-card" onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (adding) { event.preventDefault(); event.stopPropagation(); closeAdd() }
      else if (showing) { event.preventDefault(); event.stopPropagation(); event.currentTarget.querySelector('.ask-app-open[aria-expanded="true"]')?.focus(); setShowing(null) }
    }}>
      <header className="connections-apps-head"><h3>Your apps</h3><button ref={connectButton} className="primary-button" type="button" aria-expanded={adding} aria-controls="connect-an-app" onClick={() => { setMessage(null); setAdding(!adding); setForm(null); setOffers(null) }}><Plus /> Connect an app</button></header>
      {offline && <p className="bots-warning" role="status">Offline: apps OSAT uses wait until you’re back online.</p>}

      {apps.length > 0 && (
        <ul className="ask-apps" aria-label="Apps OSAT can use">
          {apps.map((app) => (
            <li key={app.id}>
              <button type="button" className="ask-app-open" aria-expanded={showing === app.id} aria-controls={`app-details-${app.id}`} onClick={() => setShowing(showing === app.id ? null : app.id)}>
                <PuzzlePiece aria-hidden="true" />
                <span className="ask-app-name"><b>{app.name}</b><small>{app.error ? 'Needs attention' : !app.on ? 'Off' : offline ? 'Paused while offline' : app.tools === null ? 'Not checked yet' : 'On'}</small></span>
                <CaretRight aria-hidden="true" />
              </button>
              <Switch checked={app.on} disabled={busy} label={`Let Ask use ${app.name}`} onChange={(on) => act(() => bridge.toggle(app.id, on))} />
              {showing === app.id && <div className="ask-app-detail" id={`app-details-${app.id}`}>
                {app.error && <p className="bots-warning" role="status">{app.error}</p>}
                <code>{app.where}</code>
                <p>{app.tools === null ? 'Turn it on and check the connection to see what OSAT can use.' : things(app.tools)}{app.checkedAt && ` · checked ${formatRelativeTime(app.checkedAt)}`}</p>
                {app.toolNames?.length > 0 && <details className="ask-app-capabilities"><summary>What OSAT can use</summary><ul className="ask-app-tools" aria-label={`What ${app.name} can do`}>{app.toolNames.map((name) => <li key={name}>{name}</li>)}</ul></details>}
                <div className="ask-app-actions">
                  <button className="outline-button" type="button" disabled={busy || offline || !app.on} onClick={() => act(() => bridge.check(app.id))}><ArrowsClockwise /> Check connection</button>
                  {app.signIn && <button className="outline-button" type="button" disabled={busy || offline} onClick={() => signInTo(app.name, app.id)}><SignIn /> {app.signedIn ? 'Sign in again' : 'Sign in'}</button>}
                  <button className="text-button" type="button" disabled={busy} onClick={() => remove(app)}>Remove</button>
                </div>
              </div>}
            </li>
          ))}
        </ul>
      )}
      {!apps.length && <div className="connections-empty"><PuzzlePiece aria-hidden="true" /><b>Your apps, working together.</b><p>Connect an app to get started. You can turn it off here.</p></div>}
      <p className="connections-privacy"><LockSimple aria-hidden="true" />Changes in another app ask you first.</p>
      {removed && (
        <p className="bots-message ask-apps-removed" role="status">
          <Check /> {removed.name} was removed.
          <button className="text-button" type="button" disabled={busy} onClick={undo}><ArrowCounterClockwise /> Undo</button>
        </p>
      )}

      {adding && <div ref={picker} tabIndex={-1} role="region" className="ask-apps-picker" id="connect-an-app" aria-label="Connect an app">
        <header><h3>Connect an app</h3><button type="button" className="icon-button" aria-label="Close Connect an app" onClick={closeAdd}><X /></button></header>
        {!form && !offers && <>
          <input className="ask-apps-find" type="search" value={find} placeholder="Find an app" aria-label="Find an app" onChange={(event) => setFind(event.target.value)} />
          <div className="ask-apps-presets">{shown.map(([name, url, what]) => {
            const existing = apps.find((app) => sameAddress(app.where, url))
            return <div key={name}><PuzzlePiece aria-hidden="true" /><span><b>{name}</b><small>{what}</small></span><button className="outline-button" type="button" disabled={busy || offline || Boolean(existing)} onClick={() => signInTo(name)}>{existing ? 'Added' : 'Connect'}</button></div>
          })}</div>
          {!shown.length && <p className="ai-note">Not in the list yet. If the app gives you a web address for AI apps (often called MCP), use it below.</p>}
          <p className="ai-note">Signing in connects the app and turns it on. You can turn it off here any time.</p>
          <div className="button-row"><button className="text-button" type="button" disabled={busy} onClick={startImport}><DownloadSimple /> Import from Claude Desktop</button><button className="text-button" type="button" disabled={busy} onClick={() => setForm({ kind: 'http', name: '', url: '', key: '', command: '' })}>Use a web address or command <CaretRight /></button></div>
        </>}
        {form && (
        <form className="bots-connect ask-apps-form" onSubmit={add}>
          <Choice label="How OSAT reaches it" value={form.kind} options={KINDS} onChange={(kind) => setForm({ ...form, kind })} />
          <label><span>Name</span><input autoFocus value={form.name} maxLength={60} placeholder="Optional, like Notion" onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          {form.kind === 'http' ? (
            <>
              <label><span>Address</span><input value={form.url} spellCheck={false} placeholder="https://example.com/mcp" onChange={(event) => setForm({ ...form, url: event.target.value })} /></label>
              <label className="bots-key"><span>Key</span><input type="password" value={form.key} autoComplete="off" spellCheck={false} placeholder="Only if it needs one" onChange={(event) => setForm({ ...form, key: event.target.value })} /></label>
            </>
          ) : (
            <>
              <label className="bots-key"><span>Command</span><input value={form.command} spellCheck={false} placeholder="npx -y @notionhq/notion-mcp-server" onChange={(event) => setForm({ ...form, command: event.target.value })} /></label>
              <p className="ai-note">OSAT runs this command on your Mac when Ask needs the app, and stops it after 10 quiet minutes. A key it needs can go in front, like NOTION_TOKEN=… npx …; OSAT keeps it in your Keychain.</p>
            </>
          )}
          <div className="button-row">
            <button className="primary-button" type="submit" disabled={busy || !(form.kind === 'http' ? form.url.trim() : form.command.trim())}><Plus /> {busy ? 'Adding…' : 'Add'}</button>
            <button className="text-button" type="button" disabled={busy} onClick={() => setForm(null)}>Back</button>
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
            <button className="text-button" type="button" disabled={busy} onClick={() => setOffers(null)}>Back</button>
          </div>
        </div>
      )}

      </div>}
      {signing && <p className="bots-message" role="status">Finish signing in to {signing} in your browser. OSAT waits here.</p>}
      {message && <p className={message.ok ? 'bots-message' : 'bots-warning'} role="status">{message.ok && <Check />} {message.text}</p>}
    </section>
  )
}
