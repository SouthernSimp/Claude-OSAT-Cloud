/* The first-run tour (Phase 27, redone for the window in Phase 73): a few short cards, each pointing at the real
   thing on the screen (a `target` selector; none means the card sits in the middle). It shows once per Mac, after
   the welcome; "Take the tour" in ⌘K brings it back. `{desk}` and `{search}` are the shortcuts as they are set now.
   Pure. */

export const TOUR = [
  {
    id: 'bar',
    target: '.app-bar .home-composer-wrap',
    title: 'Write it down, find it, or ask',
    body: 'Type anything and press Return: it lands in Just in, and OSAT works out what it is and where it goes. ⌘Return asks the AI on this Mac. Type / for everything OSAT can do.',
  },
  {
    id: 'today',
    target: '.side-tiles',
    title: 'Today is your day at a glance',
    body: 'What to do, what’s on your calendar, what came in, your habits and your money, all on one page. ⌘1 brings it back.',
  },
  {
    id: 'boards',
    target: '.side-group[aria-label="Boards"]',
    title: 'Boards keep things in their place',
    body: 'A board for each part of your work and life: a client, a project, home. OSAT files what you write onto the right one, and every move has Undo.',
  },
  {
    id: 'ask',
    target: '.app-ask-button',
    title: 'Ask, beside whatever you’re doing',
    body: 'Ask reads your notes and answers right here, on this Mac. Nothing leaves it unless you choose a cloud model.',
  },
  {
    id: 'anywhere',
    target: null,
    title: 'And from any app',
    body: '{desk} brings OSAT up, and {search} opens the quick bar: find files, what you copied, apps and notes, ask the AI, or save a sticky.',
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
