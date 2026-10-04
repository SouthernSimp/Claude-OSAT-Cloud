import { same } from '../../shared/store-core.mjs'
import { readUnpackAnswer } from '../../shared/ai-tasks.mjs'
import { unpackInto } from '../nodes-model.js'
import { purgeNotes } from '../notes-model.js'

export function applyUnpackProposal(state, nodeId, proposal) {
  const folder = state.folders.find((item) => item.id === nodeId)
  if (!folder?.packed) throw new Error('This topic has changed. Review a fresh suggestion before unpacking it.')
  const made = unpackInto(state, nodeId, readUnpackAnswer(proposal, folder.name))
  return { ...made, nodeId, originals: made.state.notes.filter((note) => made.notes.includes(note.id)), originalFolders: made.state.folders.filter((item) => made.folders.includes(item.id)) }
}

export function undoUnpackProposal(state, made) {
  const removed = new Set(made.folders.filter((id) => {
    const current = state.folders.find((folder) => folder.id === id)
    const original = made.originalFolders.find((folder) => folder.id === id)
    return !current || (current.name === original?.name && current.parentId === original?.parentId)
  }))
  const unchanged = made.originals.filter((original) => {
    const current = state.notes.find((note) => note.id === original.id)
    return current && same(current, original)
  }).map((note) => note.id)
  const home = state.folders.some((folder) => folder.id === made.nodeId) ? made.nodeId : null
  return purgeNotes({ ...state,
    folders: state.folders.filter((folder) => !removed.has(folder.id)).map((folder) => ({ ...folder, ...(removed.has(folder.parentId) ? { parentId: home } : {}), ...(folder.id === made.nodeId ? { packed: true } : {}) })),
    notes: state.notes.map((note) => removed.has(note.folderId) ? { ...note, folderId: home } : note),
  }, unchanged)
}
