/* The first-run tour (Phase 27): a few short cards, each pointing at the real thing on the
   screen (a `target` selector; none means the card sits in the middle). It shows once per Mac,
   after the welcome; "Take the tour" in ⌘K brings it back. Words are the app's own: sticky, node,
   branch, Sky. `{desk}` and `{search}` are the shortcuts as they are set now. Pure. */

export const TOUR = [
  {
    id: 'line',
    target: '.home-composer-wrap',
    title: 'One line for everything',
    body: 'Write a thought, find something, or ask your notes. Press Return and it lands on the desk as a sticky.',
  },
  {
    id: 'stickies',
    target: null,
    title: 'Stickies live on the desk',
    body: 'Double-click anywhere to write one. Drop one on another to stack them, or drag the small dot on its edge to connect two. Nothing gets filed until you say so.',
  },
  {
    id: 'sky',
    target: '.sky-entry',
    title: 'The Sky is your map',
    body: 'Your nodes and branches spread out like a mind map. Click a node to open it, double-click to focus on just that one. ⌘3 opens it from anywhere.',
  },
  {
    id: 'tools',
    target: '.app-dock [data-space="tools"]',
    title: 'Everything else is one click away',
    body: 'Journal, Calendar, Files, the Browser and more live in Tools. Press ⌘K any time to find anything.',
  },
  {
    id: 'anywhere',
    target: null,
    title: 'And from any app',
    body: '{desk} brings the desk up, and {search} opens quick search for files, what you copied, apps and notes. Everything, the AI too, stays on this Mac.',
  },
]

/* A step's words with the shortcuts filled in (`keys`: { desk, search }; a missing one reads as "The shortcut"). */
export function tourWords(step, keys = {}) {
  const fill = (text) => text.replace('{desk}', keys.desk || 'Your shortcut').replace('{search}', keys.search || 'the search shortcut')
  return { title: fill(step.title), body: fill(step.body) }
}

/* Where the card goes, beside what it points at: above when that is in the lower half of the screen,
   below when it is in the upper half (the other way, or beside, if there isn't room), the middle of
   the screen when it points at nothing. `target` is a rectangle ({ left, top, right, bottom }) or
   null; `card` and `view` are { w, h }. The card always stays on screen. */
export function cardSpot(target, card, view, { gap = 18, edge = 12 } = {}) {
  const inside = (left, top) => ({
    left: Math.round(Math.min(Math.max(left, edge), Math.max(edge, view.w - card.w - edge))),
    top: Math.round(Math.min(Math.max(top, edge), Math.max(edge, view.h - card.h - edge))),
  })
  if (!target) return { ...inside((view.w - card.w) / 2, (view.h - card.h) / 2), side: 'center' }
  const middle = { x: (target.left + target.right) / 2, y: (target.top + target.bottom) / 2 }
  const room = {
    above: target.top - gap - card.h >= edge,
    below: target.bottom + gap + card.h <= view.h - edge,
    left: target.left - gap - card.w >= edge,
    right: target.right + gap + card.w <= view.w - edge,
  }
  const order = middle.y > view.h / 2 ? ['above', 'below', 'right', 'left'] : ['below', 'above', 'right', 'left']
  const side = order.find((name) => room[name])
  if (!side) return { ...inside((view.w - card.w) / 2, (view.h - card.h) / 2), side: 'center' }
  if (side === 'above') return { ...inside(middle.x - card.w / 2, target.top - gap - card.h), side }
  if (side === 'below') return { ...inside(middle.x - card.w / 2, target.bottom + gap), side }
  if (side === 'left') return { ...inside(target.left - gap - card.w, middle.y - card.h / 2), side }
  return { ...inside(target.right + gap, middle.y - card.h / 2), side }
}
