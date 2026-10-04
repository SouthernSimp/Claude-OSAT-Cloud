import { CARD, nodesOf } from '../nodes-model.js'

// Explicitly arrange only the topic anchors. Branch offsets, free stickies,
// note identities, links and ordering are not part of this operation.
export function arrangeTopics(state, sizes = new Map()) {
  const roots = nodesOf(state.folders).map(({ folder }) => folder)
  if (roots.length < 2) return state
  const columns = Math.ceil(Math.sqrt(roots.length))
  const width = Math.max(CARD.w, ...roots.map((folder) => sizes.get(folder.id)?.w || CARD.w))
  const height = Math.max(240, ...roots.map((folder) => sizes.get(folder.id)?.h || 240))
  const positions = new Map(roots.map((folder, index) => [folder.id, { x: index % columns * (width + CARD.gap), y: Math.floor(index / columns) * (height + CARD.gap) }]))
  return { ...state, folders: state.folders.map((folder) => positions.has(folder.id) ? { ...folder, at: positions.get(folder.id) } : folder) }
}
