import assert from 'node:assert/strict'
import test from 'node:test'

import { parseStreamFrame } from '../src/local-ai.js'
import { applyAction, describeAction, extractActions, systemPrompt } from '../src/assistant/actions.js'
import { deriveTitle, newConversation, searchConversations } from '../src/assistant/chat-store.js'
import { createDefaultWorkspace } from '../src/osat-data.js'

test('stream frames yield deltas, ignore keep-alives, and end on [DONE]', () => {
  assert.equal(parseStreamFrame('data: {"choices":[{"delta":{"content":"Hel"}}]}'), 'Hel')
  assert.equal(parseStreamFrame('data: [DONE]'), null)
  assert.equal(parseStreamFrame(': keep-alive'), '')
  assert.equal(parseStreamFrame(''), '')
  assert.equal(parseStreamFrame('data: {"choices":[{"delta":{}}]}'), '')
  assert.equal(parseStreamFrame('data: {not json'), '')
  assert.throws(() => parseStreamFrame('data: {"error":"model exploded"}'), /model exploded/)
})

test('an unterminated action block never leaks raw JSON into the transcript', () => {
  const midStream = 'On it.\n\n```osat-actions\n[{"type":"next-step","text":"Call the framer"}'
  const { body, actions } = extractActions(midStream)
  assert.equal(body, 'On it.')
  assert.equal(actions.length, 0, 'a half-streamed block must not be actionable yet')
})

test('a completed action block is stripped from prose and parsed', () => {
  const reply = 'Done.\n\n```osat-actions\n[{"type":"next-step","text":"Call the framer"}]\n```'
  const { body, actions } = extractActions(reply)
  assert.equal(body, 'Done.')
  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, 'next-step')
  assert.equal(actions[0].text, 'Call the framer')
})

test('malformed or unknown actions are dropped, not surfaced', () => {
  assert.equal(extractActions('Hi\n```osat-actions\nnot json at all\n```').actions.length, 0)
  assert.equal(extractActions('Hi\n```osat-actions\n[{"type":"rm -rf"}]\n```').actions.length, 0)
  assert.equal(extractActions('Hi\n```osat-actions\n[{"type":"next-step","text":"   "}]\n```').actions.length, 0)
  // an event with no parseable start is not schedulable
  assert.equal(extractActions('Hi\n```osat-actions\n[{"type":"event","title":"X","start":"soon"}]\n```').actions.length, 0)
})

test('the action list is capped so one reply cannot flood the workspace', () => {
  const many = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ type: 'next-step', text: `step ${i}` })))
  const { actions } = extractActions('Sure.\n```osat-actions\n' + many + '\n```')
  assert.ok(actions.length <= 8, `expected a cap, got ${actions.length}`)
})

test('applying a next-step action writes a real markdown checkbox', () => {
  const state = createDefaultWorkspace()
  const { actions } = extractActions('Ok.\n```osat-actions\n[{"type":"next-step","text":"Call the framer"}]\n```')
  const next = applyAction(state, actions[0], '2026-09-10')
  const markdown = next.notes.map((note) => note.markdown).join('\n')
  assert.match(markdown, /- \[ \] Call the framer/)
  assert.notEqual(next.notes, state.notes, 'must not mutate the previous state')
})

test('applying an event action stores a sortable ISO instant', () => {
  const state = createDefaultWorkspace()
  const { actions } = extractActions(
    'Ok.\n```osat-actions\n[{"type":"event","title":"Studio visit","start":"2026-09-14T14:00"}]\n```',
  )
  const next = applyAction(state, actions[0], '2026-09-10')
  const added = next.calendar.events.find((event) => event.title === 'Studio visit')
  assert.ok(added, 'event was added')
  // stored as an instant, but it must still be 2pm local wall-clock
  assert.equal(new Date(added.start).getHours(), 14)
  assert.equal(new Date(added.start).getFullYear(), 2026)
  assert.equal(describeAction(actions[0]).label, 'Add event')
})

test('the system prompt carries today so the model cannot guess the year', () => {
  const prompt = systemPrompt(new Date(2026, 8, 10, 12))
  assert.match(prompt, /2026-09-10/)
  assert.match(prompt, /Thursday/)
  assert.match(prompt, /never emit a year earlier than 2026/)
})

test('conversations title themselves from the first question', () => {
  const blank = newConversation()
  assert.equal(deriveTitle(blank), 'New chat')

  const asked = newConversation({ messages: [{ role: 'user', content: '# What should I do today?\nmore' }] })
  assert.equal(deriveTitle(asked), 'What should I do today?')

  const long = newConversation({ messages: [{ role: 'user', content: 'x'.repeat(200) }] })
  assert.ok(deriveTitle(long).length <= 53, 'long titles are truncated for the rail')

  const named = newConversation({ title: 'Gallery planning' })
  assert.equal(deriveTitle(named), 'Gallery planning')
})

test('chat search matches titles and message bodies', () => {
  const list = [
    newConversation({ messages: [{ role: 'user', content: 'Framing quotes for the show' }] }),
    newConversation({ messages: [{ role: 'user', content: 'Tax paperwork' }] }),
  ]
  assert.equal(searchConversations(list, 'framing').length, 1)
  assert.equal(searchConversations(list, 'PAPERWORK').length, 1)
  assert.equal(searchConversations(list, '').length, 2)
  assert.equal(searchConversations(list, 'nothing here').length, 0)
})
