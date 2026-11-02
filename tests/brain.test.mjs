import assert from 'node:assert/strict'
import test from 'node:test'

import { brainGraph, learnMessages, memoryFor, readLearned } from '../src/brain/brain-model.js'
import { addMemory, aiPreamble, learnsFromChats, memoryOf, setLearnFromChats } from '../src/soul.js'

test('what the AI learns from a chat: at most three new, short facts, never a secret or a repeat', () => {
  const known = ['Nate’s client Fortis launches in December.']
  const lines = readLearned(`- Fortis launches in December, says Nate's client.\n- Sam handles pricing at Fortis.\n* Nate prefers short answers.\n1. The password for the bank is hunter2.\n- Nate wants the deck by Friday.\n- Nate likes Tuesdays for calls.\n- ok`, known)
  assert.deepEqual(lines, ['Sam handles pricing at Fortis.', 'Nate prefers short answers.', 'Nate wants the deck by Friday.'])
  assert.deepEqual(readLearned('none'), [])
  const asked = learnMessages('When does Fortis launch?', 'In December.', known)
  assert.match(asked[1].content, /Already remembered[\s\S]*Fortis launches/)
  assert.match(asked[0].content, /at most 3 lines/)
})

test('before answering, the memories that fit the question come first, then the newest', () => {
  const memory = Array.from({ length: 40 }, (_, index) => ({ id: `m${index}`, text: `Fact number ${index} about gardening` }))
  memory[3] = { id: 'm3', text: 'Fortis pays invoices late' }
  const picked = memoryFor(memory, 'When will Fortis pay?', 5)
  assert.equal(picked.length, 5)
  assert.ok(picked.some((line) => line.id === 'm3'))
  assert.ok(picked.some((line) => line.id === 'm39'), 'the newest still come')
  assert.equal(memoryFor(memory.slice(0, 4), 'anything', 5).length, 4)
  const settings = addMemory({}, 'Fortis pays invoices late', 'Chat: Invoices', 'now', 'chat-1').settings
  assert.equal(memoryOf(settings)[0].chatId, 'chat-1')
  assert.match(aiPreamble(settings, 'Fortis'), /Fortis pays invoices late/)
  assert.equal(learnsFromChats({}), true)
  assert.equal(learnsFromChats(setLearnFromChats({}, false).settings), false)
})

test('the brain graph joins boards, notes, chats and memories', () => {
  const state = {
    folders: [{ id: 'f1', name: 'Fortis' }, { id: 'f2', name: 'Launch', parentId: 'f1' }, { id: 'f3', name: 'Home' }],
    notes: [
      { id: 'n1', title: 'Pricing', markdown: 'See [[Deck]]', folderId: 'f2', updatedAt: '2026-11-01' },
      { id: 'n2', title: 'Deck', markdown: 'slides', folderId: null, refs: { Home: 'f3' }, updatedAt: '2026-10-01' },
      { id: 'd1', kind: 'day', markdown: 'today', updatedAt: '2026-11-02' },
      { id: 'n3', title: 'Old', markdown: 'gone', trashedAt: '2026-10-01' },
    ],
    chats: [{ id: 'c1', title: '', messages: [{ id: 'q', role: 'user', content: 'Plan the Fortis launch', noteIds: ['n1'] }], updatedAt: '2026-11-02' }],
  }
  const memory = [{ id: 'm1', text: 'Fortis launches in December', chatId: 'c1' }]
  const { nodes, links } = brainGraph(state, memory)
  assert.deepEqual(nodes.map((node) => node.id).sort(), ['board:f1', 'board:f3', 'chat:c1', 'memory:m1', 'note:n1', 'note:n2'].sort())
  const has = (a, b) => links.some((link) => (link.source === a && link.target === b) || (link.source === b && link.target === a))
  assert.ok(has('note:n1', 'board:f1'), 'a sticky on a branch joins its board')
  assert.ok(has('note:n1', 'note:n2'), 'a [[link]] joins two notes')
  assert.ok(has('note:n2', 'board:f3'), 'an @mention joins its board')
  assert.ok(has('chat:c1', 'note:n1'), 'a chat joins the notes it read')
  assert.ok(has('chat:c1', 'board:f1'), 'a chat joins the boards it names')
  assert.ok(has('memory:m1', 'chat:c1') && has('memory:m1', 'board:f1'))
  assert.equal(nodes.find((node) => node.id === 'chat:c1').label, 'Plan the Fortis launch')
})
