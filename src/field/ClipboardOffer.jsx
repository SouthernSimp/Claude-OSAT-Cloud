import { useEffect, useRef, useState } from 'react'

import { offerFor, offerLine } from '../../shared/clipboard-offer.mjs'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { addSticky } from '../nodes-model.js'
import { trashNotes } from '../notes-model.js'

const HOW_LONG = 12000
const STALE = 10 * 60 * 1000

/* "Add to Jordan?": copy something that looks like a customer's email or phone number and, if a node by that
   name exists (or holds that detail already), the desk offers, once, in one calm line. Add puts it in that node
   as a sticky (Undo is right there); Not now, or a few seconds, and it goes, and it never comes back for that
   copy. With the desk away when it was copied, the offer waits for the next time the desk comes up, unless that
   is more than ten minutes later. No count, nothing red. The copy stays in the clipboard history either way,
   where the quick search offers the same "Add to Jordan" in ⌘K. */
export function ClipboardOffer({ workspace, commit }) {
  const bridge = window.osatSearch
  const [shown, setShown] = useState(null)
  const [toast, showUndo] = useUndoToast()
  const pending = useRef(null)
  const latest = useRef(workspace)
  latest.current = workspace
  const enabled = useRef(true)

  useEffect(() => {
    if (!bridge) return undefined
    const take = (settings) => { enabled.current = settings?.clipboard?.offers !== false }
    bridge.settings().then(take, () => {})
    const stopSettings = bridge.onSettings(take)
    const stopCopies = bridge.onCopied((item) => {
      if (!enabled.current || !item || item.kind === 'image') return
      const offer = offerFor(item, latest.current)
      if (!offer) return
      if (document.visibilityState === 'visible') setShown({ item, offer })
      else pending.current = { item, offer, at: Date.now() }
    })
    const stopDesk = window.osatDesk?.onShown(() => {
      const waiting = pending.current
      pending.current = null
      if (waiting && Date.now() - waiting.at < STALE) setShown({ item: waiting.item, offer: waiting.offer })
    })
    return () => { stopSettings(); stopCopies(); stopDesk?.() }
  }, [bridge])

  useEffect(() => {
    if (!shown) return undefined
    const timer = window.setTimeout(() => setShown(null), HOW_LONG)
    return () => window.clearTimeout(timer)
  }, [shown])

  if (!bridge) return null

  async function add() {
    const { item, offer } = shown
    setShown(null)
    const words = (await bridge.clipboardText(item.id).catch(() => null)) ?? item.text
    let made = null
    commit((state) => { const result = addSticky(state, words, offer.folderId, { source: item.app ? `Copied in ${item.app}` : 'Clipboard' }); made = result.note; return result.state })
    if (made) showUndo(`Added to ${offer.folderName}`, () => commit((state) => trashNotes(state, [made.id])))
  }

  return (
    <>
      {shown && (
        <p className="desk-note is-offer" role="status">
          <span>{offerLine(shown.item, shown.offer)}</span>
          <button type="button" onClick={add}>Add</button>
          <button type="button" className="is-quiet" onClick={() => setShown(null)}>Not now</button>
        </p>
      )}
      {toast}
    </>
  )
}
