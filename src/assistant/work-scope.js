import { folderSubtree, isActiveNote, relatedNotes } from '../notes-model.js'

// Explicit scope wins over keyword retrieval. The outbound prompt still applies
// its content budget; the UI names any sources omitted from that budget.
export function notesForQuestion(workspace, question, context = {}) {
  const active = workspace.notes.filter(isActiveNote)
  if (context.scope === 'none') return []
  if (context.noteIds?.length) return active.filter((note) => context.noteIds.includes(note.id))
  if (context.scope === 'focus' && context.focus) {
    const inside = folderSubtree(workspace.folders, context.focus)
    return active.filter((note) => inside.has(note.folderId) && note.kind !== 'day')
  }
  return relatedNotes(active, question)
}
