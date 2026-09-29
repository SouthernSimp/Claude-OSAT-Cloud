import { useEffect, useState } from 'react'
import { Check, ClipboardText, FolderOpen, Robot } from '@phosphor-icons/react'

import { formatRelativeTime } from '../lib/ui.js'
import '../styles/bots.css'

const cleanError = (error) => String(error?.message || error || 'That didn’t work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/* What main says about the bots: the drop folder, and later the models, scans and the
   connector. Null in the browser preview. */
function useBots() {
  const bridge = typeof window === 'undefined' ? null : window.osatBots
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!bridge) return undefined
    bridge.status().then(setStatus).catch(() => {})
    return bridge.onStatus(setStatus)
  }, [bridge])
  return { bridge, status }
}

/* Settings → Bots: everything that lets Muse, Grok Bot, Claude and other AI reach OSAT. */
export function BotsSettings() {
  const { bridge, status } = useBots()
  if (!bridge) {
    return (
      <section className="content-card">
        <p className="eyebrow">BOTS</p>
        <h2>Bots reach OSAT in the Mac app.</h2>
        <p>In the Mac app, a bot like Muse saves a node file in a folder on your Mac, and it appears in your Sky.</p>
      </section>
    )
  }
  return <DropFolderCard bridge={bridge} nodes={status?.nodes} />
}

/* The drop folder: where a bot saves node files. */
function DropFolderCard({ bridge, nodes }) {
  const [message, setMessage] = useState('')
  const act = (work, done) => work().then(() => setMessage(done || ''), (error) => setMessage(cleanError(error)))
  const last = nodes?.arrived?.[0]
  return (
    <section className="content-card bots-card">
      <p className="eyebrow">NODES FROM BOTS</p>
      <h2>Bots save nodes in one folder.</h2>
      <p>A node file saved here appears in your Sky, marked New, a few seconds later. The file then moves to Added in the same folder. Nothing is deleted, and it works offline.</p>
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
      {!last && !nodes?.setAside?.length && <p className="ai-note">Nothing has arrived yet. Copy the instructions into a bot, and ask it to save a node here.</p>}
    </section>
  )
}
