import { appendToDay } from './notes-model.js'

const CHECKLIST = /^(\s*[-*+]\s+)\[([ xX])\](?:\s+)(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})/

export function nextSteps(notes) {
  return (Array.isArray(notes) ? notes : []).flatMap((note) => {
    if (!note || typeof note.id !== 'string' || typeof note.markdown !== 'string') return []
    let fence = null
    return note.markdown.split('\n').flatMap((line, index) => {
      const marker = line.match(FENCE)?.[1]
      if (marker && (!fence || (marker[0] === fence.char && marker.length >= fence.length))) {
        fence = fence ? null : { char: marker[0], length: marker.length }
        return []
      }
      if (fence) return []
      const match = line.match(CHECKLIST)
      if (!match || !match[3].trim()) return []
      return [{
        id: `${note.id}:${index + 1}`,
        noteId: note.id,
        noteTitle: note.title,
        line: index + 1,
        text: match[3].trim(),
        done: match[2].toLowerCase() === 'x',
        tag: note.tags?.[0] || '',
      }]
    })
  })
}

export function toggleNextStep(notes, step, now = new Date().toISOString()) {
  if (!step || typeof step.noteId !== 'string' || !Number.isInteger(step.line) || typeof step.text !== 'string') return notes
  return (Array.isArray(notes) ? notes : []).map((note) => {
    if (note?.id !== step.noteId || typeof note.markdown !== 'string') return note
    if (!nextSteps([note]).some((item) => item.line === step.line && item.text === step.text.trim())) return note
    const lines = note.markdown.split('\n')
    const index = step.line - 1
    const current = lines[index]?.match(CHECKLIST)
    if (!current || current[3].trim() !== step.text.trim()) return note
    lines[index] = `${current[1]}[${current[2].toLowerCase() === 'x' ? ' ' : 'x'}]${current[0].slice(current[1].length + 3, current[0].length - current[3].length)}${current[3]}`
    return { ...note, markdown: lines.join('\n'), updatedAt: now }
  })
}

/* A new next step is a checkbox on the day's page. */
export function addNextStep(state, text, dateKey) {
  if (typeof text !== 'string' || !text.trim() || /[\r\n]/.test(text) || typeof dateKey !== 'string' || !dateKey) return state
  return appendToDay(state, dateKey, `- [ ] ${text.trim()}`)
}

/* Unfinished steps on earlier daily pages. */
export function earlierSteps(notes, dateKey) {
  const earlier = (Array.isArray(notes) ? notes : []).filter((note) => note?.kind === 'day' && typeof note.date === 'string' && note.date < dateKey && !note.trashedAt)
  return nextSteps(earlier).filter((step) => !step.done)
}

/* Moves those steps onto today's page: they leave the old page and land on
   today's, in the order they were written. Nothing is lost or duplicated. */
export function bringForward(state, dateKey, now = new Date().toISOString()) {
  const steps = earlierSteps(state.notes, dateKey)
  if (!steps.length) return state
  const drop = new Map()
  for (const step of steps) drop.set(step.noteId, new Set([...(drop.get(step.noteId) || []), step.line]))
  const cleaned = {
    ...state,
    notes: state.notes.map((note) => {
      const lines = drop.get(note.id)
      if (!lines) return note
      return { ...note, markdown: note.markdown.split('\n').filter((_, index) => !lines.has(index + 1)).join('\n'), updatedAt: now }
    }),
  }
  return steps.reduce((current, step) => appendToDay(current, dateKey, `- [ ] ${step.text}`), cleaned)
}
