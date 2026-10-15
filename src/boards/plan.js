/* Phase 31, your own roadmap: what is still coming to OSAT (the Roadmap's Status table, planned or in review) as a
   board on the canvas, "Coming to OSAT", where Nate reranks it, writes in it and leaves notes; Claude reads that
   order before picking the next phase. `settings.plan` remembers the board and which sticky is which phase
   ({ boardId, notes: { [phase id]: note id } }), so a phase is only ever added once: one he deleted stays gone.
   Pure. */

import { rankOf } from '../note-core.js'
import { addSticky } from '../nodes-model.js'
import { addBoard, stickiesOn } from './boards-model.js'

export const PLAN_NAME = 'Coming to OSAT'
const OPEN = ['planned', 'now']
const GAP = 1024

/* What is still to come, in the Roadmap's order. */
export const comingPhases = (phases) => phases.filter((phase) => OPEN.includes(phase.state))
export const planText = (phase) => `Phase ${phase.id} · ${phase.what}`

/* The plan's board while it is still there, else null. */
export function planBoard(state) {
  const id = state.settings?.plan?.boardId
  return (id && state.folders.find((folder) => folder.id === id && !folder.parentId)) || null
}

/* Where a phase starts: in review → Doing; planned after everything already done (the current plan) → Next;
   older plans → Later. */
function stageFor(phase, phases) {
  if (phase.state === 'now') return 'doing'
  const lastDone = phases.reduce((last, item, index) => (item.state === 'done' ? index : last), -1)
  return phases.indexOf(phase) > lastDone ? 'next' : 'later'
}

function addPhases(state, wanted, boardId, notes, stageOf) {
  let next = state
  let rank = Math.max(0, ...stickiesOn(state, boardId).map(rankOf))
  const added = []
  for (const phase of wanted) {
    const made = addSticky(next, planText(phase), boardId, { source: 'Roadmap' })
    if (!made.note) continue
    rank += GAP
    const stage = stageOf(phase)
    next = { ...made.state, notes: made.state.notes.map((note) => (note.id === made.note.id ? { ...note, stage, rank } : note)) }
    notes[phase.id] = made.note.id
    added.push(phase.id)
  }
  return { state: next, added }
}

/* The board, made once with every phase still to come. { state, folder } */
export function setUpPlan(state, phases) {
  const made = addBoard(state, PLAN_NAME)
  if (!made.folder) return { state, folder: null }
  const notes = {}
  const { state: next } = addPhases(made.state, comingPhases(phases), made.folder.id, notes, (phase) => stageFor(phase, phases))
  return { state: { ...next, settings: { ...(next.settings || {}), plan: { boardId: made.folder.id, notes } } }, folder: made.folder }
}

/* Keeps the board in step with a newer Roadmap: phases planned since are added (to Later, or Doing if in review),
   and a phase that was merged or dropped is ticked off. Nothing Nate moved or wrote is changed.
   { state, added: [ids], finished: [ids] }; the same state when there is nothing to do. */
export function syncPlan(state, phases, at = new Date().toISOString()) {
  const board = planBoard(state)
  if (!board) return { state, added: [], finished: [] }
  const notes = { ...(state.settings.plan.notes || {}) }
  // Added later, a planned phase waits in Later: what is in Next, and in what order, is Nate's.
  const fresh = comingPhases(phases).filter((phase) => !notes[phase.id])
  const { state: grown, added } = addPhases(state, fresh, board.id, notes, (phase) => (phase.state === 'now' ? 'doing' : 'later'))
  const over = new Set(phases.filter((phase) => !OPEN.includes(phase.state) && notes[phase.id]).map((phase) => notes[phase.id]))
  const finished = []
  const ticked = grown.notes.map((note) => {
    if (!over.has(note.id) || note.doneAt || note.trashedAt) return note
    finished.push(Object.keys(notes).find((id) => notes[id] === note.id))
    return { ...note, doneAt: at }
  })
  if (!added.length && !finished.length) return { state, added, finished }
  return { state: { ...grown, notes: ticked, settings: { ...grown.settings, plan: { ...grown.settings.plan, notes } } }, added, finished }
}
