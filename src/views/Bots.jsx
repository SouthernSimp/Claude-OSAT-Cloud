import { useEffect, useState } from 'react'
import { Check, ClipboardText, Cloud, FolderOpen, Laptop, LockSimple, Plus, Robot } from '@phosphor-icons/react'

import { OTHER, PRESETS } from '../../shared/providers.mjs'
import { useAi } from '../assistant/useAi.js'
import { formatRelativeTime } from '../lib/ui.js'
import { ConnectorCard } from './bots/ConnectorCard.jsx'
import '../styles/bots.css'

const cleanError = (error) => String(error?.message || error || 'That didn’t work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const number = (value) => new Intl.NumberFormat('en-US').format(value || 0)
const shortDate = (iso) => (iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso)) : '')

/* What main says about the bots: the drop folder, the models, and later the scans and the
   connector. Null in the browser preview. */
function useBots() {
  const bridge = typeof window === 'undefined' ? null : window.osatBots
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!bridge) return undefined
    bridge.status().then(setStatus).catch(() => {})
    return bridge.onStatus(setStatus)
  }, [bridge])
  return { bridge, status, setStatus }
}

/* Settings → Bots: everything that lets Muse, Grok Bot, Claude and other AI reach OSAT, and
   every model and privacy choice, in one place. */
export function BotsSettings() {
  const { bridge, status } = useBots()
  if (!bridge) {
    return (
      <section className="content-card">
        <p className="eyebrow">BOTS</p>
        <h2>Bots reach OSAT in the Mac app.</h2>
        <p>In the Mac app, a bot like Muse saves a topic file in a folder on your Mac, and it appears on your canvas. Cloud models connect there too.</p>
      </section>
    )
  }
  return (
    <>
      <DropFolderCard bridge={bridge} nodes={status?.nodes} />
      <ModelCard bridge={bridge} cloud={status?.cloud} offline={status?.offline} />
      <CloudCard bridge={bridge} cloud={status?.cloud} />
      <ConnectorCard bridge={bridge} connector={status?.connector} />
    </>
  )
}

/* The drop folder: where a bot saves node files. */
function DropFolderCard({ bridge, nodes }) {
  const [message, setMessage] = useState('')
  const act = (work, done) => work().then(() => setMessage(done || ''), (error) => setMessage(cleanError(error)))
  const last = nodes?.arrived?.[0]
  return (
    <section className="content-card bots-card">
      <p className="eyebrow">NODES FROM BOTS</p>
      <h2>Bots save topics in one folder.</h2>
      <p>A topic file saved here appears on your canvas, marked New, a few seconds later. The file then moves to Added in the same folder. Nothing is deleted, and it works offline.</p>
      {nodes?.dir && <p className="settings-path">{nodes.dir}</p>}
      {nodes?.error && <p className="bots-warning" role="status">{nodes.error}</p>}
      <div className="button-row">
        <button className="primary-button" type="button" onClick={() => act(bridge.copyInstructions, 'Copied. Paste it into Muse, Grok Bot or Claude as the bot’s instructions.')}>
          <ClipboardText /> Copy instructions for a bot
        </button>
        <button className="outline-button" type="button" onClick={() => act(bridge.showNodes)}>
          <FolderOpen /> Show in Finder
        </button>
      </div>
      {message && <p className="bots-message" role="status"><Check /> {message}</p>}
      {(nodes?.arrived?.length > 0 || nodes?.setAside?.length > 0) && (
        <ul className="bots-arrivals" aria-label="Recently">
          {nodes.arrived.map((item) => (
            <li key={`${item.at}-${item.name}`}>
              <Robot aria-hidden="true" />
              <span>
                {item.same ? <>“{item.name}” was already in OSAT as <b>{item.node}</b>, so nothing new was made.</> : <><b>{item.node}</b>{item.source ? ` from ${item.source}` : ''}{item.packed ? ', packed' : ''}</>}
              </span>
              <small>{formatRelativeTime(item.at)}</small>
            </li>
          ))}
          {nodes.setAside.map((item) => (
            <li key={`${item.at}-${item.name}`} className="is-aside">
              <FolderOpen aria-hidden="true" />
              <span>“{item.name}” is in Set aside. {item.why} Nothing was lost.</span>
              <small>{formatRelativeTime(item.at)}</small>
            </li>
          ))}
        </ul>
      )}
      {!last && !nodes?.setAside?.length && <p className="ai-note">Nothing has arrived yet. Copy the instructions into a bot, and ask it to save a topic here.</p>}
    </section>
  )
}

/* Which AI answers the line, Ask, Help me sort, Unpack with AI and scans: this Mac (the
   default, nothing leaves) or a connected cloud model. What leaves the Mac is said here. */
function ModelCard({ bridge, cloud, offline }) {
  const { models } = useAi()
  const [message, setMessage] = useState('')
  const local = (models || []).find((model) => model.offline !== false)
  const chosen = cloud?.model || 'local'
  const choose = (model) => bridge.chooseModel(model).then(() => setMessage(''), (error) => setMessage(cleanError(error)))
  return (
    <section className="content-card bots-card">
      <p className="eyebrow">MODEL</p>
      <h2>{cloud?.leavesMac ? `${cloud.leavesMac} answers.` : 'The AI on this Mac answers.'}</h2>
      <p>The model you pick answers the line, Ask, Help me sort and Unpack with AI. Scans (Settings → Data) are always sorted by the AI on this Mac.</p>
      <div className="bots-models" role="radiogroup" aria-label="Which AI answers">
        <button type="button" role="radio" aria-checked={chosen === 'local'} className="bots-model" onClick={() => choose('local')}>
          <Laptop aria-hidden="true" />
          <strong>On this Mac</strong>
          <span>{local ? `${local.name} · nothing leaves this Mac` : 'Not set up yet: choose a size in Settings → AI'}</span>
        </button>
        {(cloud?.providers || []).map((provider) => {
          const id = `cloud:${provider.id}:${provider.model}`
          return (
            <div key={provider.id} role="radio" tabIndex={0} aria-checked={chosen.startsWith(`cloud:${provider.id}:`)} className="bots-model" onClick={() => choose(id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(id) } }}>
              <Cloud aria-hidden="true" />
              <strong>{provider.name}</strong>
              {provider.models?.length > 1 ? (
                <select aria-label={`${provider.name} model`} value={provider.model} onClick={(event) => event.stopPropagation()} onChange={(event) => choose(`cloud:${provider.id}:${event.target.value}`)}>
                  {provider.models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              ) : <span>{provider.model}</span>}
            </div>
          )
        })}
      </div>
      <p className="bots-privacy">
        <LockSimple aria-hidden="true" />
        {cloud?.leavesMac
          ? offline
            ? `Offline: ${cloud.leavesMac} waits until you’re back online, and the AI on this Mac answers meanwhile.`
            : `What you ask, the notes Ask reads and the stickies Help me sort and Unpack look at go to ${cloud.leavesMac}. Choose On this Mac to keep everything here.`
          : 'Everything stays on this Mac. A cloud model is only used once you connect one and pick it.'}
      </p>
      {message && <p className="bots-warning" role="status">{message}</p>}
    </section>
  )
}

/* Connect any AI provider: pick it, paste the key, done. Keys go to the Keychain. */
function CloudCard({ bridge, cloud }) {
  const [preset, setPreset] = useState(PRESETS[0].id)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const chosen = PRESETS.find((item) => item.id === preset) || OTHER
  const connected = cloud?.providers || []

  async function connect(event) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const made = await bridge.connect(preset === OTHER.id ? { name, baseUrl, key, model } : { preset, key })
      setKey('')
      setMessage({ ok: true, text: `Connected. ${made.name} answers now, with ${made.model}.` })
    } catch (error) {
      setMessage({ ok: false, text: cleanError(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="content-card bots-card">
      <p className="eyebrow">CLOUD MODELS</p>
      <h2>Connect any AI.</h2>
      <p>Pick the provider, paste its API key, and it’s ready. DeepSeek, OpenAI, xAI (Grok), OpenRouter, Mistral, Groq, or any other that works like OpenAI.</p>
      <form className="bots-connect" onSubmit={connect}>
        <label>
          <span>Provider</span>
          <select value={preset} onChange={(event) => { setPreset(event.target.value); setMessage(null) }}>
            {PRESETS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value={OTHER.id}>{OTHER.name}…</option>
          </select>
        </label>
        {preset === OTHER.id && (
          <>
            <label><span>Name</span><input value={name} placeholder="Its name" onChange={(event) => setName(event.target.value)} /></label>
            <label><span>Address</span><input value={baseUrl} placeholder="https://api.example.com/v1" spellCheck={false} onChange={(event) => setBaseUrl(event.target.value)} /></label>
            <label><span>Model</span><input value={model} placeholder="Optional: its model’s name" spellCheck={false} onChange={(event) => setModel(event.target.value)} /></label>
          </>
        )}
        <label className="bots-key">
          <span>API key</span>
          <input type="password" value={key} autoComplete="off" spellCheck={false} placeholder={`Paste your ${chosen.name} key`} onChange={(event) => setKey(event.target.value)} />
        </label>
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={busy || !key.trim()}><Plus /> {busy ? 'Checking the key…' : 'Connect'}</button>
          {chosen.keys && <button className="text-button" type="button" onClick={() => bridge.openPage(chosen.keys).catch((error) => setMessage({ ok: false, text: cleanError(error) }))}>Get a {chosen.name} key</button>}
        </div>
      </form>
      {message && <p className={message.ok ? 'bots-message' : 'bots-warning'} role="status">{message.ok && <Check />} {message.text}</p>}
      {connected.length > 0 && (
        <ul className="bots-providers" aria-label="Connected">
          {connected.map((provider) => (
            <li key={provider.id}>
              <Cloud aria-hidden="true" />
              <span>
                <b>{provider.name}</b>
                <small>{usageLine(provider)}</small>
              </span>
              {provider.usagePage && <button type="button" className="text-button" onClick={() => bridge.openPage(provider.usagePage).catch(() => {})}>See the bill</button>}
              <button type="button" className="text-button" onClick={() => bridge.removeProvider(provider.id).catch((error) => setMessage({ ok: false, text: cleanError(error) }))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <p className="ai-note">{cloud?.lasting === false ? 'There’s no Keychain here, so keys are kept only until OSAT quits.' : 'Keys are kept in your Mac’s Keychain, never in a file. Remove takes the key out of the Keychain.'}</p>
    </section>
  )
}

/* "12 questions · 3,400 tokens · about $0.01 since Sep 29" */
function usageLine(provider) {
  const total = provider.usage
  if (!total?.requests) return 'Nothing asked yet.'
  return [
    `${number(total.requests)} ${total.requests === 1 ? 'question' : 'questions'}`,
    `${total.estimated ? 'about ' : ''}${number(total.input + total.output)} tokens`,
    provider.cost,
    total.since ? `since ${shortDate(total.since)}` : '',
  ].filter(Boolean).join(' · ')
}
