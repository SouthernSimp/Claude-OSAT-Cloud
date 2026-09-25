/* Proposed workspace actions.
   The model may append a fenced `osat-actions` block holding a JSON array. We
   strip it from the visible reply and surface each entry as a card the user
   approves. Nothing is ever applied without an explicit click. */

import { addNextStep } from '../next-steps.js'
import { captureThought } from '../notes-model.js'
import { normalizeNote } from '../osat-data.js'
import { makeId } from '../lib/ui.js'

const BLOCK = /```(?:osat-actions|osat_actions)\s*\n([\s\S]*?)```/gi
/* While a reply is still streaming the fence has no terminator yet; hide it anyway
   so raw JSON never flashes in the transcript. */
const OPEN_BLOCK = /```(?:osat-actions|osat_actions)[\s\S]*$/i
const MAX_ACTIONS = 8
const MAX_TEXT = 500

/* The model has no clock. Without today's date it guesses the year, so every
   scheduling request has to carry it. */
export function systemPrompt(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now)
  return `You are a private thinking partner running locally on this Mac. Be concise, concrete and warm. Use Markdown.

Today is ${weekday}, ${today}. Resolve every relative date ("tomorrow", "next Friday", "the 14th") against that date, and never emit a year earlier than ${now.getFullYear()} unless the person is clearly recording something that already happened.

When — and only when — the person clearly asks you to add, create, schedule or capture something in their workspace, append a fenced block at the very end of your reply:

\`\`\`osat-actions
[{"type":"next-step","text":"Call the vendor"}]
\`\`\`

Allowed types:
- {"type":"next-step","text":"..."} — one actionable step
- {"type":"note","title":"...","markdown":"..."} — a new note
- {"type":"capture","text":"..."} — a raw thought to sort later (it lands in Unsorted)
- {"type":"event","title":"...","start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM"} — a calendar event

Never invent actions the person did not ask for. Never mention this block in your prose; they see it as buttons. If nothing is requested, omit the block entirely.`
}

const text = (value, max = MAX_TEXT) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : ''

/* Accepts local wall-clock text ("2026-09-11T14:00") and rejects anything else. */
function localStamp(value) {
  if (typeof value !== 'string') return ''
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!match) return ''
  const [, y, mo, d, h, mi] = match.map(Number)
  const date = new Date(y, mo - 1, d, h, mi)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function validate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = raw.type
  if (type === 'next-step' || type === 'capture') {
    const value = text(raw.text)
    return value ? { type, text: value.replace(/[\r\n]+/g, ' ') } : null
  }
  if (type === 'note') {
    const title = text(raw.title, 120) || 'Untitled note'
    const markdown = text(raw.markdown ?? raw.body, 8000)
    return markdown ? { type, title, markdown } : null
  }
  if (type === 'event') {
    const title = text(raw.title, 200)
    const start = localStamp(raw.start)
    if (!title || !start) return null
    const end = localStamp(raw.end)
    return { type, title, start, end: end && end > start ? end : '', notes: text(raw.notes, 1000) }
  }
  return null
}

/* Splits a raw reply into the prose to display and the actions to offer. */
export function extractActions(reply) {
  const actions = []
  const body = String(reply ?? '').replace(BLOCK, (_match, json) => {
    try {
      const parsed = JSON.parse(json.trim())
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        const action = validate(entry)
        if (action && actions.length < MAX_ACTIONS) actions.push({ ...action, id: makeId('act') })
      }
    } catch {
      /* a malformed block is dropped, never shown as prose */
    }
    return ''
  })
  return { body: body.replace(OPEN_BLOCK, '').trimEnd(), actions }
}

export function describeAction(action) {
  if (action.type === 'next-step') return { label: 'Add next step', detail: action.text }
  if (action.type === 'capture') return { label: 'Save to Unsorted', detail: action.text }
  if (action.type === 'note') return { label: 'Create note', detail: action.title }
  return {
    label: 'Add event',
    detail: `${action.title} · ${new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(action.start))}`,
  }
}

/* Pure: returns the next workspace with the action applied. */
export function applyAction(state, action, today) {
  if (action.type === 'next-step') {
    return addNextStep(state, action.text, today)
  }
  if (action.type === 'capture') {
    return captureThought(state, action.text, 'Local AI').state
  }
  if (action.type === 'note') {
    const note = normalizeNote({
      id: `note-${crypto.randomUUID()}`,
      title: action.title,
      markdown: action.markdown,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    return { ...state, notes: [note, ...state.notes] }
  }
  if (action.type === 'event') {
    const event = {
      id: makeId('event'),
      title: action.title,
      start: action.start,
      end: action.end,
      notes: action.notes,
    }
    return {
      ...state,
      calendar: {
        ...state.calendar,
        events: [...state.calendar.events, event].sort(
          (a, b) => Date.parse(a.start) - Date.parse(b.start),
        ),
      },
    }
  }
  return state
}
