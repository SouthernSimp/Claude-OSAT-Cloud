import { findAll } from '../lib/find.js'
import { isBranch } from '../notes-model.js'

// Use the same matching rules as the desk, with destinations restricted to Sky.
export function findSky(workspace, query) {
  if (!String(query || '').trim()) return []
  return findAll({ ...workspace, notes: workspace.notes.filter((note) => note.kind !== 'day') }, query, { limit: 40 })
    .filter((row) => row.kind === 'note' || row.kind === 'folder')
    .slice(0, 8)
    .map((row) => {
      const folder = row.kind === 'folder' && workspace.folders.find((item) => item.id === row.go[1].folderId)
      return { ...row, type: folder ? (folder.parentId || isBranch(folder) ? 'Branch' : 'Node') : 'Sticky' }
    })
}
