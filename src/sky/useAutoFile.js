import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { gistMessages, readGistAnswer } from '../../shared/ai-tasks.mjs'
import { cleanError, useAi } from '../assistant/useAi.js'
import { streamLocalMessage } from '../local-ai.js'
import { autoFileSettings, fileForYou, fileRequests, filedLine, filingGroups, GISTS, needsGist, readyToFile, withGist } from './auto-file.js'
import { undoFiling } from './sort-review.js'

/* Runs auto-file.js on the desk, which is always open (hidden or not): once a pile of new
   stickies has been quiet for a moment, the model chosen in Bots shortens the long ones and
   files them all, then one line says where they went, with Undo. It asks as a background job,
   so a model that is asleep, unloaded by Nate or short of memory is never woken for it: the
   stickies wait and "Filed for you" in Notes says why. */

const TRIED = 'osat.autofile.tried.v1'
const RETRY_MS = 5 * 60000

// Stickies the AI has already read (filed, or left for Nate): never asked about twice. This Mac only.
function readTried() {
  try { return new Set(JSON.parse(localStorage.getItem(TRIED) || '[]')) } catch { return new Set() }
}
function keepTried(set) {
  try { localStorage.setItem(TRIED, JSON.stringify([...set].slice(-3000))) } catch { /* only a convenience */ }
}

/* What filing is doing, for Notes' "Filed for you": { state: 'idle' | 'waiting' | 'filing' | 'no-ai' | 'resting', count?, message? }. */
let shown = { state: 'idle' }
const listeners = new Set()
function say(next) {
  if (shown.state === next.state && shown.count === next.count && shown.message === next.message) return
  shown = next
  listeners.forEach((listener) => listener())
}
export const useAutoFileStatus = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => shown)

export function useAutoFile({ workspace, commit, hydrated, onFiled, onToast }) {
  const { models } = useAi()
  const { on, since } = autoFileSettings(workspace?.settings)
  const model = models?.[0] || null
  const tried = useRef(null)
  const busy = useRef(false)
  const resting = useRef(0)
  const [tick, setTick] = useState(0)
  const latest = useRef({ onFiled, onToast })
  latest.current = { onFiled, onToast }

  // It counts from the first time it runs, so a pile from before is only filed when Nate says so.
  useEffect(() => {
    if (!hydrated || !on || since) return
    const start = new Date().toISOString()
    commit((state) => ({ ...state, settings: { ...state.settings, autoFile: { ...(state.settings?.autoFile || {}), on: true, since: start } } }))
  }, [hydrated, on, since]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated || !workspace || busy.current) return undefined
    if (!on) { say({ state: 'idle' }); return undefined }
    if (!since) return undefined
    tried.current ??= readTried()
    const now = Date.now()
    const { ready, wait } = readyToFile(workspace, { since, tried: tried.current, now })
    const later = (ms) => { const timer = setTimeout(() => setTick((n) => n + 1), ms + 50); return () => clearTimeout(timer) }
    if (wait > 0) { say({ state: 'waiting' }); return later(wait) }
    if (!ready.length) { say({ state: 'idle' }); return undefined }
    if (!model) { say({ state: 'no-ai', count: ready.length }); return undefined }
    if (now < resting.current) return later(resting.current - now)
    run(ready.map((note) => note.id), model)
    return undefined
  }, [workspace, hydrated, on, since, model?.id, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(ids, chosen) {
    busy.current = true
    say({ state: 'filing', count: ids.length })
    const ask = async (messages) => {
      const text = await streamLocalMessage({ model: chosen.id, messages, background: true })
      if (!String(text || '').trim()) throw new Error('The AI gave an empty answer')
      return text
    }
    const waiting = (state) => {
      const set = new Set(ids)
      return state.notes.filter((note) => set.has(note.id) && note.unsorted && !note.folderId && !note.trashedAt)
    }
    try {
      // Long stickies first, so the filing reads their short version.
      for (const note of waiting(commit((state) => state)).filter(needsGist).slice(0, GISTS)) {
        const gist = readGistAnswer(await ask(gistMessages(note.markdown)))
        if (gist) commit((state) => withGist(state, note.id, gist))
      }
      const stickies = waiting(commit((state) => state))
      if (!stickies.length) return
      const { places, batches } = fileRequests(commit((state) => state), stickies)
      const answers = []
      for (const batch of batches) answers.push({ from: batch.from, text: await ask(batch.messages) })
      let done = null
      commit((state) => { done = fileForYou(state, filingGroups(state, stickies, places, answers)); return done.state })
      stickies.forEach((note) => tried.current.add(note.id))
      keepTried(tried.current)
      if (done?.moved.length) {
        const restores = done.moved.map((id) => latest.current.onFiled?.(id)).filter((restore) => typeof restore === 'function')
        const undo = () => {
          commit((state) => undoFiling(state, done.changes, done.made).state)
          restores.forEach((restore) => restore())
        }
        latest.current.onToast?.(filedLine(done.state, done.moved), undo)
      }
      resting.current = 0
      say({ state: 'idle' })
    } catch (error) {
      // Asleep, unloaded, offline, or a cloud model that failed: try again in a while.
      resting.current = Date.now() + RETRY_MS
      say({ state: 'resting', count: ids.length, message: cleanError(error) })
    } finally {
      busy.current = false
      setTick((n) => n + 1)
    }
  }
}
