import assert from 'node:assert/strict'
import test from 'node:test'

import { parseStreamFrame } from '../src/local-ai.js'
import { applyAction, describeAction, extractActions, systemPrompt, wantsActions } from '../src/assistant/actions.js'
import { deriveTitle, newChat as newConversation, normalizeChat, outbound, searchChats as searchConversations } from '../src/assistant/chats.js'
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

test('chats load unchanged, and damaged messages are dropped rather than invented', () => {
  const chat = { id: 'chat-1', title: '', createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:05:00.000Z', messages: [
    { id: 'm1', role: 'user', content: 'Hi', at: '2026-09-25T10:00:00.000Z', noteIds: ['n1'] },
    { id: 'm2', role: 'assistant', content: 'Hello', at: '2026-09-25T10:00:01.000Z' },
  ] }
  assert.deepEqual(normalizeChat(chat), chat)
  assert.equal(normalizeChat({ ...chat, messages: [...chat.messages, { role: 'user', content: 'no id' }, { id: 'x', role: 'tool', content: 'nope' }] }).messages.length, 2)
  assert.equal(normalizeChat({ title: 'no id' }), null)
})

test('a question carries the notes Ask picked, and a long chat is trimmed to fit', () => {
  const notes = [{ id: 'n1', title: 'Garden', markdown: 'Plant tomatoes.' }]
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }))
  const sent = outbound('system', history, 'When?', notes, ['n1', 'gone'])
  assert.equal(sent.length, 22)
  assert.equal(sent[0].role, 'system')
  assert.match(sent.at(-1).content, /^When\?\n\n\[FROM MY NOTES/)
  assert.match(sent.at(-1).content, /NOTE: Garden\nPlant tomatoes\./)
  assert.equal(outbound('s', [], 'Plain', notes, []).at(-1).content, 'Plain')
})

test('action cards only come when the question asks for something to be added', () => {
  assert.equal(wantsActions('Add a step to call the framer'), true)
  assert.equal(wantsActions('Remind me to water the plants on Friday'), true)
  assert.equal(wantsActions('Can you schedule lunch with Sam next Tuesday?'), true)
  assert.equal(wantsActions('What do I need to do in the garden before it gets cold?'), false)
  assert.equal(wantsActions('When should I book the cabin?'), false)
})
