import { useEffect, useState } from 'react'
import { ArrowCounterClockwise, Check, ClipboardText, LockSimple, PaperPlaneTilt, Plus, Tray, WebhooksLogo } from '@phosphor-icons/react'

import { MOMENTS, NTFY_SERVER } from '../../../shared/webhook-model.mjs'
import { formatRelativeTime } from '../../lib/ui.js'
import { Switch } from '../settings/parts.jsx'
import '../../styles/bots-webhooks.css'

const cleanError = (error) => String(error?.message || error || 'That didn’t work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const host = (address) => { try { return new URL(address).host } catch { return address } }

/* What main says about the webhooks (desktop/bots/webhooks.cjs). Null in the browser preview. */
function useHooks() {
  const bridge = typeof window === 'undefined' ? null : window.osatHooks
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!bridge) return undefined
    bridge.status().then(setStatus).catch(() => {})
    return bridge.onStatus(setStatus)
  }, [bridge])
  return { bridge, status }
}

/* One action at a time, and one calm line about how it went (with Undo when there is one). */
function useAct() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const act = async (work, done, undo) => {
    setBusy(true)
    try {
      await work()
      setMessage(done ? { ok: true, text: done, undo } : null)
    } catch (error) {
      setMessage({ ok: false, text: cleanError(error) })
    } finally {
      setBusy(false)
    }
  }
  const line = message && (
    <p className={message.ok ? 'bots-message' : 'bots-warning'} role="status">
      {message.ok && <Check />} {message.text}
      {message.undo && <button className="text-button" type="button" onClick={() => act(message.undo)}><ArrowCounterClockwise /> Undo</button>}
    </p>
  )
  return { busy, act, line }
}

/* Settings → Bots (Phase 46): OSAT tells other services what happens, and services add stickies. */
export function WebhooksCard() {
  const { bridge, status } = useHooks()
  if (!bridge) return null
  return (
    <>
      <SendCard bridge={bridge} hooks={status?.hooks || []} offline={status?.offline} />
      <InboxCard bridge={bridge} inbox={status?.inbox} offline={status?.offline} />
    </>
  )
}

function Moments({ value, onChange, disabled = false }) {
  return (
    <fieldset className="hooks-moments" disabled={disabled}>
      <legend>Send when</legend>
      {MOMENTS.map((moment) => (
        <label key={moment.id}>
          <input type="checkbox" checked={value.includes(moment.id)} onChange={(event) => onChange(event.target.checked ? [...value, moment.id] : value.filter((id) => id !== moment.id))} />
          {moment.label}
        </label>
      ))}
    </fieldset>
  )
}

/* "Sent 2m ago", "3 waiting until you’re back online", or what went wrong and what to do. */
function lastLine(hook) {
  if (hook.waiting) return `${hook.waiting} waiting until you’re back online.`
  if (!hook.last) return 'Nothing sent yet.'
  return hook.last.ok ? `Sent ${formatRelativeTime(hook.last.at)}.` : hook.last.text
}

/* Out: the addresses OSAT tells, each with the moments it sends. */
function SendCard({ bridge, hooks, offline }) {
  const { busy, act, line } = useAct()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [events, setEvents] = useState(['sticky.added'])

  const add = (event) => {
    event.preventDefault()
    act(async () => {
      await bridge.add({ url, name, events })
      setUrl('')
      setName('')
    }, 'Added. Send a test to see it arrive.')
  }
  const remove = (hook) => act(
    () => bridge.remove(hook.id),
    `Removed ${hook.name}.`,
    () => bridge.add({ url: hook.url, name: hook.name, events: hook.events }),
  )

  return (
    <section className="content-card bots-card">
      <p className="eyebrow">WEBHOOKS</p>
      <h2>{hooks.length ? 'OSAT tells other services what happens.' : 'Tell other services when something happens.'}</h2>
      <p>Paste a web address from Zapier, Make, IFTTT, Slack, Discord or your own server, and pick the moments. OSAT sends each one there as it happens. Slack and Discord show it as a message with no other setup.</p>
      {hooks.length > 0 && (
        <ul className="hooks-list" aria-label="Where OSAT sends">
          {hooks.map((hook) => (
            <li key={hook.id} className="hooks-row">
              <div className="hooks-head">
                <WebhooksLogo aria-hidden="true" />
                <span><b>{hook.name}</b><small>{host(hook.url)}</small></span>
                <Switch checked={hook.on} label={`Send to ${hook.name}`} onChange={(on) => act(() => bridge.change(hook.id, { on }))} />
              </div>
              <Moments value={hook.events} disabled={!hook.on} onChange={(next) => act(() => bridge.change(hook.id, { events: next }))} />
              <div className="hooks-foot">
                <small className={hook.last && !hook.last.ok && !hook.waiting ? 'is-problem' : ''}>{lastLine(hook)}</small>
                <button className="outline-button" type="button" disabled={busy || offline} onClick={() => act(() => bridge.test(hook.id), `Sent a test to ${hook.name}.`)}><PaperPlaneTilt /> Send a test</button>
                <button className="text-button" type="button" disabled={busy} onClick={() => remove(hook)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="hooks-add" onSubmit={add}>
        <label className="hooks-field"><span>Address</span><input type="url" value={url} placeholder="https://hooks.zapier.com/…" spellCheck={false} onChange={(event) => setUrl(event.target.value)} /></label>
        <label className="hooks-field"><span>Name</span><input value={name} placeholder="Optional: Zapier, Slack…" onChange={(event) => setName(event.target.value)} /></label>
        <Moments value={events} onChange={setEvents} />
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={busy || !url.trim() || !events.length}><Plus /> Add</button>
        </div>
      </form>
      {line}
      <p className="bots-privacy">
        <LockSimple aria-hidden="true" />
        {offline
          ? 'Offline: what happens waits here (up to 100 moments) and is sent when you’re back online.'
          : 'Each moment sends only its own words (the sticky and its topic, the topic’s name, or the journal line) to that address. Offline, they wait and go when you’re back online.'}
      </p>
    </section>
  )
}

/* In: an ntfy address services send words to; OSAT reads it and each message becomes a sticky. */
function InboxCard({ bridge, inbox, offline }) {
  const { busy, act, line } = useAct()
  const [server, setServer] = useState('')
  const on = Boolean(inbox?.on)
  const relay = inbox?.host || host(NTFY_SERVER)

  const chooseServer = (event) => {
    event.preventDefault()
    act(async () => {
      await bridge.inboxServer(server.trim())
      setServer('')
    }, server.trim() ? 'OSAT reads from your server now.' : `OSAT reads from ${host(NTFY_SERVER)} again.`)
  }

  return (
    <section className="content-card bots-card">
      <p className="eyebrow">STICKIES FROM SERVICES</p>
      <h2>{on ? 'Services can add stickies.' : 'Let services add stickies.'}</h2>
      <p>Zapier, IFTTT, a form or a script can add a sticky to Unsorted by sending words to one web address. The words come through ntfy, a free relay OSAT checks every minute, so your Mac stays closed to the internet.</p>
      {inbox?.error && <p className="bots-warning" role="status">{inbox.error}</p>}
      <div className="button-row">
        {on
          ? <button className="outline-button" type="button" disabled={busy} onClick={() => act(bridge.inboxOff)}>Turn off</button>
          : <button className="primary-button" type="button" disabled={busy} onClick={() => act(bridge.inboxOn)}><Tray /> Turn on</button>}
        {on && <button className="text-button" type="button" disabled={busy} onClick={() => act(bridge.inboxReset, 'New address made. The old one stopped working: give your services this one.')}>Reset address</button>}
      </div>
      {on && inbox.address && (
        <div className="bots-setups">
          <div className="bots-setup">
            <strong>Send words to this address</strong>
            <pre>{inbox.address}</pre>
            <button className="outline-button" type="button" onClick={() => act(bridge.copyAddress, 'Copied the address.')}><ClipboardText /> Copy</button>
          </div>
          <div className="bots-setup">
            <strong>For example</strong>
            <p>In Terminal:</p>
            <pre>{`curl -d "Buy milk" ${inbox.address}`}</pre>
            <p>In Zapier, IFTTT or a form: send a POST to this address with the words as the body.</p>
          </div>
        </div>
      )}
      {line}
      {on && (
        <p className="ai-note">
          {inbox.lastAt ? `The last sticky came in ${formatRelativeTime(inbox.lastAt)}.` : 'Nothing has come in yet.'}
          {offline ? ' Offline: OSAT checks again when you’re back online.' : ''}
        </p>
      )}
      <details className="hooks-server">
        <summary>Your own ntfy server</summary>
        <form onSubmit={chooseServer}>
          <input type="url" value={server} aria-label="Your ntfy server" placeholder={inbox?.server || NTFY_SERVER} spellCheck={false} onChange={(event) => setServer(event.target.value)} />
          <button className="outline-button" type="submit" disabled={busy}>{server.trim() ? 'Use it' : `Use ${host(NTFY_SERVER)}`}</button>
        </form>
      </details>
      <p className="bots-privacy">
        <LockSimple aria-hidden="true" />
        The words pass through {relay} on their way. Anyone with the address can add stickies, so keep it to yourself; Reset address makes a new one and the old one stops working.
      </p>
    </section>
  )
}
