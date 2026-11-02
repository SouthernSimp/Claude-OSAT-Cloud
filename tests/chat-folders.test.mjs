import assert from 'node:assert/strict'
import test from 'node:test'

import { addChatFolder, chatFoldersOf, groupChats, moveChat, normalizeChat, pinChat, removeChatFolder, renameChat, renameChatFolder } from '../src/assistant/chats.js'
import { SCHEMA, createEmptyDoc, migrate } from '../shared/store-core.mjs'

const chat = (id, updatedAt, extra = {}) => ({ id, title: id, messages: [], createdAt: updatedAt, updatedAt, ...extra })

test('schema 19: chats may be pinned or in a folder, and a workspace from before opens as it was', () => {
  assert.ok(SCHEMA >= 19)
  const before = { ...createEmptyDoc(), schema: 18, chats: [chat('a', '2026-11-01')] }
  assert.deepEqual(migrate(before).chats, before.chats)
  assert.deepEqual(normalizeChat(chat('a', 'x', { pinned: true, folderId: 'f1' })).pinned, true)
  assert.equal(normalizeChat(chat('a', 'x', { pinned: 'yes', folderId: 7 })).pinned, undefined)
  assert.equal(normalizeChat(chat('a', 'x', { folderId: 7 })).folderId, undefined)
})

test('folders, pins and names: the list keeps its order, a deleted folder keeps its chats', () => {
  let state = { ...createEmptyDoc(), chats: [chat('old', '2026-10-01'), chat('mid', '2026-10-15'), chat('new', '2026-11-01')] }
  const { state: withFortis, folder } = addChatFolder(state, '  Fortis ')
  state = withFortis
  assert.equal(folder.name, 'Fortis')
  assert.equal(addChatFolder(state, 'fortis').folder.id, folder.id, 'the same name is the same folder')
  assert.equal(addChatFolder(state, '   ').folder, null)
  state = moveChat(state, 'mid', folder.id)
  state = pinChat(state, 'old', true)
  state = renameChat(state, 'new', '  Q4 plan  ')
  assert.equal(state.chats.find((item) => item.id === 'old').updatedAt, '2026-10-01', 'pinning doesn’t change a chat’s time')
  const groups = groupChats(state.chats, chatFoldersOf(state.settings))
  assert.deepEqual(groups.pinned.map((item) => item.id), ['old'])
  assert.deepEqual(groups.folders.map((entry) => [entry.folder.name, entry.chats.map((item) => item.id)]), [['Fortis', ['mid']]])
  assert.deepEqual(groups.rest.map((item) => item.title), ['Q4 plan'])
  state = renameChatFolder(state, folder.id, 'Fortis work')
  assert.equal(chatFoldersOf(state.settings)[0].name, 'Fortis work')
  state = removeChatFolder(state, folder.id)
  assert.deepEqual(chatFoldersOf(state.settings), [])
  assert.equal(state.chats.find((item) => item.id === 'mid').folderId, undefined)
  assert.deepEqual(groupChats(state.chats, []).rest.map((item) => item.id), ['new', 'mid'])
  state = pinChat(state, 'old', false)
  assert.equal(state.chats.find((item) => item.id === 'old').pinned, undefined)
})
