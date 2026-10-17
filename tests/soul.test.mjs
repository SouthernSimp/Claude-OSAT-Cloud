import test from 'node:test'
import assert from 'node:assert/strict'

import { addMemory, aiPreamble, DEFAULT_SOUL, forgetMemory, memoryLines, memoryOf, setSoul, soulOf } from '../src/soul.js'
import { sortUnsortedMessages } from '../shared/ai-tasks.mjs'
import { systemPrompt } from '../src/assistant/actions.js'

test('SOUL.md starts as OSAT’s own and is whatever Nate writes after', () => {
  assert.equal(soulOf({}), DEFAULT_SOUL)
  const state = setSoul({ settings: {} }, 'Be brief.')
  assert.equal(soulOf(state.settings), 'Be brief.')
  assert.doesNotMatch(aiPreamble(setSoul({ settings: {} }, '').settings), /SOUL/, 'an empty soul says nothing')
})

test('MEMORY.md starts from About you, then lines come and go', () => {
  const old = { settings: { aboutMe: "I'm Nate.\n\nI run a small business." } }
  assert.deepEqual(memoryLines(old.settings), ["I'm Nate.", 'I run a small business.'])
  assert.equal(memoryOf(old.settings)[0].from, 'You wrote it in About you')

  const added = addMemory(old, '  Food goes to   Groceries ', 'You told OSAT', '2026-10-16T12:00:00Z')
  const lines = memoryOf(added.settings)
  assert.deepEqual(lines.map((line) => line.text), ["I'm Nate.", 'I run a small business.', 'Food goes to Groceries'])
  assert.equal(addMemory(old, '   '), old, 'nothing to remember changes nothing')

  const forgot = forgetMemory(added, lines[0].id)
  assert.deepEqual(memoryLines(forgot.settings), ['I run a small business.', 'Food goes to Groceries'])
  assert.equal(forgot.settings.aboutMe, old.settings.aboutMe, 'About you itself is kept')
})

test('Ask reads the soul and the memory; filing reads the memory', () => {
  const settings = { soul: 'Plain words.', memory: [{ id: 'm1', text: 'Mac mini notes go on mccreery.ai', from: 'You told OSAT' }] }
  const prompt = systemPrompt(new Date(2026, 9, 16, 12), aiPreamble(settings), 'THEIR OSAT')
  assert.ok(prompt.indexOf('Plain words.') < prompt.indexOf('- Mac mini notes go on mccreery.ai'))
  assert.ok(prompt.indexOf('Mac mini') < prompt.indexOf('THEIR OSAT'), 'soul and memory before the map')

  const filing = sortUnsortedMessages({ places: [{ name: 'mccreery.ai' }], stickies: ['Order the Mac mini'], memory: memoryLines(settings) })
  assert.match(filing[1].content, /What they told OSAT to remember:\n- Mac mini notes go on mccreery.ai/)
  assert.doesNotMatch(sortUnsortedMessages({ places: [], stickies: ['x'] })[1].content, /remember/)
})
