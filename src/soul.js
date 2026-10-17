/* Phase 70, soul and memory: what the AI reads before it answers. SOUL.md is who OSAT is and how it talks
   (`settings.soul`, a default until Nate changes it); MEMORY.md is what it knows about him, one line each with where
   it came from and Forget on each (`settings.memory`: [{ id, text, from, at }], the old "About you" lines until he
   changes it). RULES.md is the switches that already decide what the AI does alone (auto-file.js, intake/dates.js),
   shown in Settings → Soul and memory. Pure. */

import { makeId } from './lib/ui.js'

export const DEFAULT_SOUL = `I am OSAT. I live on this Mac and work offline.

How I talk
- Plain words. Short sentences. No jargon.
- I say what I did and how to undo it.
- I never nag, and I never count things at you.

What I care about
- Nothing you write is ever lost.
- You do the thinking. I do the sorting and the prep.
- Every idea gets back to you when it matters.`

const MAX = 4000

export const soulOf = (settings) => (typeof settings?.soul === 'string' ? settings.soul : DEFAULT_SOUL)

export function memoryOf(settings) {
  if (Array.isArray(settings?.memory)) return settings.memory.filter((line) => typeof line?.text === 'string' && line.text.trim())
  return String(settings?.aboutMe || '').split('\n').map((text) => text.trim()).filter(Boolean)
    .map((text, index) => ({ id: `about-${index}`, text, from: 'You wrote it in About you' }))
}

const withSettings = (state, patch) => ({ ...state, settings: { ...(state.settings || {}), ...patch } })

export const setSoul = (state, soul) => withSettings(state, { soul })

export function addMemory(state, text, from = 'You told OSAT', at = new Date().toISOString()) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!words) return state
  return withSettings(state, { memory: [...memoryOf(state.settings), { id: makeId('mem'), text: words, from, at }] })
}

export const forgetMemory = (state, id) => withSettings(state, { memory: memoryOf(state.settings).filter((line) => line.id !== id) })

/* What the AI reads first, for Ask's system prompt. */
export function aiPreamble(settings) {
  const soul = soulOf(settings).trim()
  const memory = memoryOf(settings)
  return [
    soul && `Who you are and how you talk (SOUL.md, the person can change it):\n${soul.slice(0, MAX)}`,
    memory.length && `What you know about the person (MEMORY.md; use it quietly to fit your answers, never repeat it back):\n${memory.map((line) => `- ${line.text}`).join('\n').slice(0, MAX)}`,
  ].filter(Boolean).join('\n\n')
}

/* MEMORY.md as lines for a filing prompt ("Notes about the Mac mini go on mccreery.ai"). */
export const memoryLines = (settings) => memoryOf(settings).map((line) => line.text)
