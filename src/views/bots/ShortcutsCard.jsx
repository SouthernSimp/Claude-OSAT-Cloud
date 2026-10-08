import { useState } from 'react'
import { BookOpen, ChatCircle, Check, Export, MagnifyingGlass, Microphone, NotePencil, Plus } from '@phosphor-icons/react'

import { SHORTCUTS } from '../../../shared/shortcut-file.mjs'
import '../../styles/bots-shortcuts.css'

const ICONS = { add: Microphone, send: Export, write: NotePencil, read: BookOpen, find: MagnifyingGlass, ask: ChatCircle }
const cleanError = (error) => String(error?.message || error || 'That didn’t work.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/* Settings → Bots → Siri and Shortcuts (Phase 47): ready-made shortcuts that reach OSAT through
   the connector. A button has main sign one, and Shortcuts asks Nate to add it. */
export function ShortcutsCard({ bridge, connector }) {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState(null)
  const on = connector?.on && connector.running

  async function add({ id, name }) {
    setBusy(id)
    try {
      await bridge.addShortcut(id)
      setMessage({ ok: true, text: `Shortcuts opened “${name}”. Choose Add Shortcut there.` })
    } catch (error) {
      setMessage({ ok: false, text: cleanError(error) })
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="content-card bots-card">
      <p className="eyebrow">SIRI AND SHORTCUTS</p>
      <h2>Talk to OSAT with Siri.</h2>
      {!on && <p>Turn on the connector above, and Siri can add to OSAT, read your journal, find stickies and answer from your notes.</p>}
      {on && (
        <>
          <p>Add these to Shortcuts, and Siri and the Share menu reach OSAT on this Mac.</p>
          <ul className="bots-shortcuts" aria-label="Shortcuts">
            {SHORTCUTS.map((item) => {
              const Icon = ICONS[item.id]
              return (
                <li key={item.id}>
                  <Icon aria-hidden="true" />
                  <span>
                    <b>{item.name}</b>
                    <small>{item.say}</small>
                  </span>
                  <button className="outline-button" type="button" disabled={Boolean(busy)} onClick={() => add(item)}>
                    <Plus /> {busy === item.id ? 'Getting it ready…' : 'Add to Shortcuts'}
                  </button>
                </li>
              )
            })}
          </ul>
          {message && <p className={message.ok ? 'bots-message' : 'bots-warning'} role="status">{message.ok && <Check />} {message.text}</p>}
          <p className="ai-note">They reach OSAT as the app “Shortcuts” in the connector above. If you reset its key or remove it, add them again. They run on this Mac; on your iPhone they can’t reach it.</p>
        </>
      )}
    </section>
  )
}
