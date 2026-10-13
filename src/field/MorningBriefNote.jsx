import { useEffect, useRef, useState } from 'react'

import '../styles/morning-brief.css'

const OFFERED = 'osat.brief.offered.v1'
// How long each line stays: the offer is made once, so it waits longer.
const HOW_LONG = { ready: 15000, offer: 60000 }

const askedOnce = (workspace) => (workspace?.chats || []).some((chat) => chat.messages?.some((message) => message.role === 'user'))
// True the first time only: the offer is made once on this Mac, whatever the answer. Without storage, never.
function firstOffer() {
  try {
    if (localStorage.getItem(OFFERED)) return false
    localStorage.setItem(OFFERED, '1')
    return true
  } catch {
    return false
  }
}

/* The morning brief on the desk (Phase 49, desktop/brief.cjs). Once Ask has been used, the desk offers the brief one
   time, in one small line (Turn on / Not now). After a brief is written on its own, the next time the desk comes up
   one quiet line says it's in today's journal, with Open, for a few seconds. No count, no sound. */
export function MorningBriefNote({ workspace, navigate }) {
  const bridge = window.osatBrief
  const [problem, setProblem] = useState('')
  const undo = useRef(null)
  const [where, setWhere] = useState('')
  const [shown, setShown] = useState(null) // 'ready' | 'offer'
  const latest = useRef(workspace)
  latest.current = workspace

  useEffect(() => {
    if (!bridge) return undefined
    const look = () => bridge.status().then((status) => {
      setWhere(status.cloud ? status.where : '')
      if (status.unseen) {
        undo.current = status.undo
        setShown('ready')
        bridge.seen().catch(() => {})
      } else if (!status.on && status.ai && askedOnce(latest.current) && firstOffer()) setShown('offer')
    }, () => {})
    look()
    return window.osatDesk?.onShown(look)
  }, [bridge])

  useEffect(() => {
    if (!shown) return undefined
    const timer = window.setTimeout(() => setShown(null), HOW_LONG[shown])
    return () => window.clearTimeout(timer)
  }, [shown])

  if (!bridge || !shown) return null
  if (shown === 'ready') {
    return (
      <p className="desk-note is-offer is-brief" role="status">
        <span>{problem || "Your morning brief is in today’s journal"}</span>
        <button type="button" onClick={() => { setShown(null); navigate('Journal') }}>Open</button>
        {undo.current && <button type="button" className="is-quiet" onClick={() => bridge.undo(undo.current).then(() => setShown(null), (error) => setProblem(error.message))}>Undo</button>}
      </p>
    )
  }
  return (
    <p className="desk-note is-offer is-brief" role="status">
      <span>{where ? `Want a morning brief from ${where}? Calendar and journal context leave this Mac.` : 'Want a short plan for your day at the top of your journal each morning?'}</span>
      <button type="button" onClick={() => { setShown(null); bridge.set({ on: true }).catch(() => {}) }}>Turn on</button>
      <button type="button" className="is-quiet" onClick={() => setShown(null)}>Not now</button>
    </p>
  )
}
