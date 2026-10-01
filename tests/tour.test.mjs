import assert from 'node:assert/strict'
import test from 'node:test'

import { cardSpot, TOUR, tourWords } from '../src/shell/tour-model.js'

const VIEW = { w: 1440, h: 900 }
const CARD = { w: 380, h: 190 }

test('the tour has a few short cards in plain words, and every target is a real place on the desk', () => {
  assert.ok(TOUR.length >= 4 && TOUR.length <= 6, 'a few cards, not a lecture')
  assert.equal(new Set(TOUR.map((step) => step.id)).size, TOUR.length)
  for (const step of TOUR) {
    assert.ok(step.title.length <= 40 && step.body.length <= 220, `${step.id} is short`)
    assert.doesNotMatch(`${step.title} ${step.body}`, /\b(Inbox|folder|record|canonical|OSAT Field)\b/, `${step.id} uses OSAT's own words`)
  }
  assert.deepEqual(TOUR.filter((step) => step.target).map((step) => step.target), ['.home-composer-wrap', '.sky-entry', '.app-dock [data-space="tools"]'])
})

test('the shortcuts are filled in as they are set now, with a plain fallback', () => {
  const step = TOUR.find((item) => item.id === 'anywhere')
  assert.match(tourWords(step, { desk: '⌥Space', search: '⌘⇧Space' }).body, /^⌥Space brings the desk up, and ⌘⇧Space opens quick search/)
  assert.match(tourWords(step).body, /^Your shortcut brings the desk up, and the search shortcut opens/)
  assert.equal(tourWords(TOUR[0]).title, TOUR[0].title, 'a card with no shortcut is unchanged')
})

test('the card sits above what is low on the screen, below what is high, and never leaves the screen', () => {
  const dock = { left: 560, top: 830, right: 880, bottom: 890 }
  const above = cardSpot(dock, CARD, VIEW)
  assert.equal(above.side, 'above')
  assert.ok(above.top + CARD.h <= dock.top, 'clear of the dock')
  const line = { left: 500, top: 60, right: 940, bottom: 120 }
  assert.equal(cardSpot(line, CARD, VIEW).side, 'below')
  // A target in the corner: still fully on screen.
  const corner = cardSpot({ left: 1380, top: 830, right: 1436, bottom: 896 }, CARD, VIEW)
  assert.ok(corner.left >= 12 && corner.left + CARD.w <= VIEW.w - 12 && corner.top >= 12 && corner.top + CARD.h <= VIEW.h - 12)
  // No target, or no room anywhere: the middle.
  assert.deepEqual(cardSpot(null, CARD, VIEW), { left: 530, top: 355, side: 'center' })
  assert.equal(cardSpot({ left: 0, top: 0, right: 400, bottom: 400 }, { w: 380, h: 380 }, { w: 400, h: 400 }).side, 'center')
  // A small window: the card is kept inside it.
  const small = cardSpot(dock, CARD, { w: 500, h: 400 })
  assert.ok(small.left >= 12 && small.left + CARD.w <= 500 - 12)
})
