/* Where does this branch belong? (Phase 27): the model reads the branch and picks one place,
   or none; nothing moves until the person says Move. Pure. */

import { folderChildren, folderSubtree } from '../notes-model.js'
import { pileOf } from '../nodes-model.js'
import { sortPlaces } from './sort-unsorted.js'

/* Every node and branch it could go in: not itself, nothing inside it, and not where it already is. */
export function wherePlaces(state, folderId) {
  const own = folderSubtree(state.folders, folderId)
  const parent = state.folders.find((folder) => folder.id === folderId)?.parentId || null
  return sortPlaces(state, (folder) => own.has(folder.id) || folder.id === parent)
}

/* A few words from inside the branch, for the question: its stickies' titles, then its own branches. */
export const branchWords = (state, folderId) => [
  ...pileOf(state.notes, folderId).map((note) => note.title),
  ...folderChildren(state.folders, folderId).map((folder) => folder.name),
].slice(0, 5)
