/* Ask can act (Phase 48): when a question asks to do something, the AI may use tools in the Mac app
   (window.osatAgent, desktop/agent.cjs). `wantsTools` says when; the hook runs one question, keeps the
   steps and a question from another app ("Allow" / "Not now") while it works, and the Undo for what
   each answer changed while main still holds it (this window, until a restart). */
import { useEffect, useRef, useState } from 'react'
import { wantsActions } from './actions.js'

const DOING = /\b(move|file|sort|rename|delete|remove|trash|schedule|remind|find|search|look (?:up|for|in|through)|check|what[’']?s on|what is on|calendar|journal|branch|topic)\b/i

/* A question that asks to do or look something up, or names an app Nate connected. */
export function wantsTools(question, apps = []) {
  const text = String(question || '')
  const lower = text.toLowerCase()
  return wantsActions(text) || DOING.test(text) || apps.some((name) => typeof name === 'string' && name.trim() && lower.includes(name.trim().toLowerCase()))
}

let runs = 0

export function useAgent() {
  const bridge = typeof window === 'undefined' ? null : window.osatAgent || null
  const [apps, setApps] = useState([])
  const [steps, setSteps] = useState([])
  const [asking, setAsking] = useState(null)
  const [undos, setUndos] = useState({}) // answer id → undo id, or 'undone'
  const askingRef = useRef(null)
  askingRef.current = asking

  useEffect(() => {
    if (!bridge?.apps) return undefined
    let live = true
    bridge.apps().then((list) => { if (live && Array.isArray(list)) setApps(list) }, () => {})
    return () => { live = false }
  }, [bridge])

  /* One question, acted on: { answer, steps, undo, error? }. The answer's pieces go to onDelta as they come. */
  async function act({ model, messages, signal, onDelta }) {
    const id = `agent-${Date.now().toString(36)}-${++runs}`
    const shown = new Map()
    setSteps([])
    setAsking(null)
    const run = bridge.run(id, { model, messages }, (event) => {
      if (event.type === 'step' && typeof event.id === 'string') {
        shown.set(event.id, event)
        setSteps([...shown.values()])
      } else if (event.type === 'confirm') setAsking({ id, stepId: event.stepId, text: String(event.text || '') })
      else if (event.type === 'delta' && typeof event.text === 'string') onDelta(event.text)
    })
    signal?.addEventListener('abort', () => run.cancel(), { once: true })
    try {
      return await run.done
    } finally {
      setAsking(null)
      setSteps([])
    }
  }

  function answer(yes) {
    const now = askingRef.current
    if (!now) return
    setAsking(null)
    bridge.confirm(now.id, now.stepId, yes === true).catch(() => {})
  }

  async function undo(messageId) {
    await bridge.undo(undos[messageId])
    setUndos((current) => ({ ...current, [messageId]: 'undone' }))
  }

  return {
    can: Boolean(bridge),
    wants: (question) => Boolean(bridge) && wantsTools(question, apps),
    act,
    steps,
    asking,
    answer,
    keepUndo: (messageId, undoId) => setUndos((current) => ({ ...current, [messageId]: undoId })),
    undoState: (messageId) => (undos[messageId] === 'undone' ? 'undone' : undos[messageId] ? 'ready' : null),
    undo,
  }
}
