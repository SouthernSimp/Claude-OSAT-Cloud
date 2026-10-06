import { useEffect, useRef, useState } from 'react'

import { streamLocalMessage } from '../local-ai.js'
import { aiState } from './ai-state.js'
import { cleanError } from './useAi.js'

/* One AI job at a time (a sticky's home, or sorting them all), with its state spoken by
   aiState: waking, reading, too slow, failed. `run(work)` calls `work(ask)`, where
   `ask(messages)` asks `model` and resolves with its whole answer, and resolves with
   { ok, result }, { failed }, { slow } (it gave up waiting) or { stale } (stopped or replaced).
   On failed or slow the caller falls back to matching words; the line already says so. */
export function useAiJob({ status, model, models, offline }) {
  const [job, setJob] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const current = useRef(null)
  const running = Boolean(job?.since)

  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  useEffect(() => () => current.current?.controller.abort(), [])

  const state = aiState({ status, model, models, offline, job, now: running ? now : Date.now() })

  // A model that won't wake: stop waiting, so words can answer instead.
  useEffect(() => {
    if (!state.giveUp || !current.current) return
    const mine = current.current
    mine.gaveUp = true
    current.current = null
    mine.controller.abort()
    setJob({ slow: true })
  }, [state.giveUp])

  async function run(work) {
    current.current?.controller.abort()
    const mine = { controller: new AbortController(), gaveUp: false }
    current.current = mine
    const since = Date.now()
    setNow(since)
    setJob({ since })
    const ask = async (messages) => {
      if (!model) throw new Error('The AI isn’t set up yet')
      const text = await streamLocalMessage({ model: model.id, messages, signal: mine.controller.signal })
      mine.controller.signal.throwIfAborted()
      if (!String(text || '').trim()) throw new Error('The AI gave an empty answer')
      return text
    }
    try {
      const result = await work(ask)
      if (current.current !== mine) return mine.gaveUp ? { slow: true } : { stale: true }
      current.current = null
      setJob(null)
      return { ok: true, result }
    } catch (error) {
      if (current.current !== mine) return mine.gaveUp ? { slow: true } : { stale: true }
      current.current = null
      setJob({ failed: cleanError(error) })
      return { failed: true }
    }
  }

  return {
    state,
    run,
    /* Say something about the last answer (e.g. it named no place we know). */
    fail(message) { setJob({ failed: message }) },
    stop() { current.current?.controller.abort(); current.current = null; setJob(null) },
    clear() { if (!current.current) setJob(null) },
  }
}
