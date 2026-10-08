import { useState } from 'react'
import { ArrowCounterClockwise, Check, ClipboardText, Plug, Plus } from '@phosphor-icons/react'

import { connectorSetup } from '../../../shared/connector-tools.mjs'
import { formatRelativeTime } from '../../lib/ui.js'
import { Choice } from '../settings/parts.jsx'
import '../../styles/connector-apps.css'

const cleanError = (error) => String(error?.message || error || 'That didn’t work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const ACCESS = [['read', 'Can look'], ['write', 'Can look and change']]

/* What to paste in each kind of app: [which, name, how]. */
const SETUPS = [
  ['claude-code', 'Claude Code', 'Run this once in Terminal:'],
  ['claude-desktop', 'Claude Desktop', 'Add this to Claude Desktop’s config (Settings → Developer → Edit Config), then restart it:'],
  ['other', 'Grok Bot and other apps', 'Where an app asks for an MCP server, give it this address and header:'],
  ['api', 'Shortcuts and scripts', 'The same tools as a plain web address: find your stickies, add one, write in the journal (in Shortcuts, use Get Contents of URL with this header):'],
]

/* The OSAT connector: an MCP server on this Mac only (Phase 44). Each app that may reach it has
   its own key and may only look, or look and change; its key never comes to this window, only
   to the clipboard. What apps changed lately is listed with Undo. */
export function ConnectorCard({ bridge, connector }) {
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [access, setAccess] = useState('read')
  const [open, setOpen] = useState(null) // the app whose setup shows
  const act = async (work, done) => {
    setBusy(true)
    try {
      await work()
      setMessage(done ? { ok: true, text: done } : null)
    } catch (error) {
      setMessage({ ok: false, text: cleanError(error) })
    } finally {
      setBusy(false)
    }
  }
  const on = connector?.on && connector.running
  const apps = connector?.apps || []

  const add = (event) => {
    event.preventDefault()
    act(async () => {
      const status = await bridge.addApp({ name, access })
      setName('')
      setOpen(status?.apps?.at(-1)?.id || null)
    }, 'Added. Copy its setup below, with its key.')
  }

  return (
    <section className="content-card bots-card">
      <p className="eyebrow">CONNECTOR</p>
      <h2>{on ? 'Apps on this Mac can reach OSAT.' : 'Let apps on this Mac reach OSAT.'}</h2>
      <p>The OSAT connector lets Claude Code, Claude Desktop, Shortcuts and other apps find, read and add topics, stickies and journal lines. It only listens on this Mac, never on the network. Each app gets its own key, and you choose whether it can only look or also change things.</p>
      {connector?.error && <p className="bots-warning" role="status">{connector.error}</p>}
      <div className="button-row">
        {on
          ? <button className="outline-button" type="button" disabled={busy} onClick={() => act(bridge.connectorOff)}>Turn off</button>
          : <button className="primary-button" type="button" disabled={busy} onClick={() => act(bridge.connectorOn)}><Plug /> Turn on</button>}
      </div>
      {on && (
        <>
          <h3 className="connector-apps-title">Apps that can reach OSAT</h3>
          {apps.length ? (
            <ul className="connector-apps">
              {apps.map((app) => (
                <li key={app.id}>
                  <span className="connector-app-name">
                    <b>{app.name}</b>
                    <small>{app.usedAt ? `Used ${formatRelativeTime(app.usedAt)}` : 'Not used yet'}</small>
                  </span>
                  <Choice label={`What ${app.name} may do`} value={app.access} options={ACCESS} onChange={(value) => act(() => bridge.setAppAccess(app.id, value))} />
                  <span className="connector-app-actions">
                    <button className="text-button" type="button" aria-expanded={open === app.id} onClick={() => setOpen(open === app.id ? null : app.id)}><ClipboardText /> Copy setup</button>
                    <button className="text-button" type="button" disabled={busy} onClick={() => act(async () => { await bridge.resetAppKey(app.id); setOpen(app.id) }, `New key made for ${app.name}. The old one stopped working: copy its setup again.`)}>Reset key</button>
                    <button className="text-button" type="button" disabled={busy} onClick={() => act(async () => { await bridge.removeApp(app.id); setOpen(null) })}>Remove</button>
                  </span>
                  {open === app.id && (
                    <div className="bots-setups">
                      {SETUPS.map(([id, label, how]) => (
                        <div key={id} className="bots-setup">
                          <strong>{label}</strong>
                          <p>{how}</p>
                          <pre>{connectorSetup(id, { url: connector.url, key: '••••••••' })}</pre>
                          <button className="outline-button" type="button" onClick={() => act(() => bridge.copySetup(id, app.id), `Copied for ${label}, with ${app.name}’s key.`)}><ClipboardText /> Copy with the key</button>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="ai-note">No app can reach OSAT yet. Add one below.</p>}
          {connector.removed && (
            <p className="bots-message connector-removed" role="status">
              <Check /> {connector.removed.name} was removed, and its key stopped working.
              <button className="text-button" type="button" disabled={busy} onClick={() => act(bridge.undoRemoveApp)}><ArrowCounterClockwise /> Undo</button>
            </p>
          )}
          <form className="connector-add" onSubmit={add}>
            <input type="text" value={name} maxLength={40} placeholder="An app’s name, like Claude Code" aria-label="The app’s name" onChange={(event) => setName(event.target.value)} />
            <Choice label="What it may do" value={access} options={ACCESS} onChange={setAccess} />
            <button className="primary-button" type="submit" disabled={busy || !name.trim()}><Plus /> Add</button>
          </form>
        </>
      )}
      {message && <p className={message.ok ? 'bots-message' : 'bots-warning'} role="status">{message.ok && <Check />} {message.text}</p>}
      {connector?.recent?.length > 0 && (
        <ul className="bots-arrivals" aria-label="Lately through the connector">
          {connector.recent.map((item) => (
            <li key={item.at}>
              <Plug aria-hidden="true" />
              <span>{item.text}</span>
              <button className="text-button" type="button" onClick={() => act(() => bridge.undoConnector(item.at))}><ArrowCounterClockwise /> Undo</button>
            </li>
          ))}
        </ul>
      )}
      <p className="ai-note">Muse’s custom connectors run in Meta’s cloud, so they can’t reach this Mac. Muse saves topics through the folder above instead.</p>
    </section>
  )
}
