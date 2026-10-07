import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { cleanSettings } from '../shared/launcher-model.mjs'
import {
  actionsFor, buildRows, detailsFor, fileKind, fileWords, isPicture, looksLikeQuestion, rankApps, rankCommands, readTyped, scopesOn, sizeText, startRow, wants, wordRows,
} from '../shared/quick-search-model.mjs'

const { validHotkey } = createRequire(import.meta.url)('../desktop/desk.cjs')
const settings = cleanSettings(undefined, { validHotkey })
const now = new Date(2026, 8, 29, 9, 30)
const at = (day, hour) => new Date(2026, 8, day, hour).toISOString()
const clip = (id, text, extra = {}) => ({ id, kind: 'text', at: at(29, 8), text, chars: text.length, ...extra })
const file = (name, extra = {}) => ({ rootId: 'documents', relative: `Taxes/${name}`, name, kind: 'file', size: 1258291, modifiedAt: '2026-09-20T10:00:00Z', where: 'Documents › Taxes', match: 'name', ...extra })

test('what is typed is read: a keyword at the start picks the tab, a sum answers', () => {
  const plain = readTyped('taxes', settings)
  assert.deepEqual([plain.scope, plain.query, plain.math, plain.keyword], ['all', 'taxes', null, null])
  const v = readTyped('v invoice', settings)
  assert.deepEqual([v.scope, v.query], ['clipboard', 'invoice'])
  assert.deepEqual([readTyped('f pdf taxes', settings).scope, readTyped('f pdf taxes', settings).query], ['files', 'pdf taxes'])
  assert.equal(readTyped('n', settings).scope, 'notes')
  assert.equal(readTyped('2*49', settings).math.text, '98')
  assert.equal(readTyped('ss', settings).keyword.keyword.app, 'Spotify')
  assert.equal(readTyped('g best crms', settings).keyword.query, 'best crms')
  // Once a tab is picked, another source's keyword and sums are just words; its own keyword is still not part of them.
  assert.deepEqual([readTyped('v invoice', settings, 'clipboard').scope, readTyped('v invoice', settings, 'clipboard').query], ['clipboard', 'invoice'])
  assert.deepEqual([readTyped('v 2*49', settings, 'files').scope, readTyped('v 2*49', settings, 'files').math], ['files', null])
  const noCalc = cleanSettings({ sources: { calc: { on: false } } }, { validHotkey })
  assert.equal(readTyped('2*49', noCalc).math, null)
  assert.deepEqual(readTyped('   ', settings).query, '')
})

test('the tabs are the sources that are on', () => {
  assert.deepEqual(scopesOn(settings).map(([id]) => id), ['all', 'files', 'clipboard', 'apps', 'notes', 'windows'])
  const some = cleanSettings({ sources: { clipboard: { on: false }, apps: { on: false } } }, { validHotkey })
  assert.deepEqual(scopesOn(some).map(([id]) => id), ['all', 'files', 'notes', 'windows'])
})

test('each source is asked only what it can answer', () => {
  const ask = (text, scope, options) => wants(readTyped(text, settings, scope), settings, options)
  assert.deepEqual(ask('t', 'all'), { files: false, recentFiles: false, clipboard: true, apps: true })
  assert.deepEqual(ask('tax', 'all'), { files: true, recentFiles: false, clipboard: true, apps: true })
  assert.deepEqual(ask('', 'all'), { files: false, recentFiles: true, clipboard: true, apps: false })
  assert.deepEqual(ask('', 'files'), { files: false, recentFiles: true, clipboard: false, apps: false })
  assert.deepEqual(ask('', 'files', { fileFilter: 'pdf' }), { files: true, recentFiles: false, clipboard: false, apps: false }, 'a kind alone is a search')
  assert.deepEqual(ask('x', 'clipboard'), { files: false, recentFiles: false, clipboard: true, apps: false })
  const off = cleanSettings({ sources: { files: { on: false }, clipboard: { on: false } } }, { validHotkey })
  assert.deepEqual(wants(readTyped('tax', off), off), { files: false, recentFiles: false, clipboard: false, apps: true })
  assert.equal(fileWords('taxes', 'pdf'), 'pdf taxes')
  assert.equal(fileWords('', 'all'), '')
  assert.equal(fileWords('  ', 'picture'), 'photos')
})

test('Everything is one list: a sum, a keyword, apps, files, copies, then notes', () => {
  const found = {
    files: [file('Taxes 2025.pdf'), file('Taxes summary.pdf')],
    clipboard: { items: [clip('a', 'Jordan owes for taxes', { app: 'Mail' }), clip('b', 'unrelated')] },
    apps: [{ name: 'Taxes Helper', path: '/Applications/Taxes Helper.app' }, { name: 'Notes', path: '/Applications/Notes.app' }],
    notes: [{ key: 'note:1', label: 'Taxes to do', hint: 'Money', kind: 'note', go: ['Notes', { noteId: '1' }] }, { key: 'folder:2', label: 'Taxes', kind: 'folder', go: ['Mindmap', { folderId: '2' }] }],
  }
  const rows = buildRows(readTyped('taxes', settings), found, settings, { now })
  assert.deepEqual(rows.map((row) => [row.section, row.kind, row.title]), [
    ['Apps', 'app', 'Taxes Helper'],
    ['Files', 'file', 'Taxes 2025.pdf'],
    ['Files', 'file', 'Taxes summary.pdf'],
    ['Clipboard', 'text', 'Jordan owes for taxes'],
    ['Notes', 'note', 'Taxes to do'],
    ['Notes', 'node', 'Taxes'],
  ])
  assert.equal(rows[3].subtitle, 'Mail · 1 hour ago')
  const math = buildRows(readTyped('2*49', settings), found, settings, { now })
  assert.deepEqual([math[0].kind, math[0].title, math[0].data.plain], ['calc', '= 98', '98'])
  const link = buildRows(readTyped('g best crms', settings), {}, settings, { now })
  assert.deepEqual([link[0].kind, link[0].title, link[0].data.url], ['keyword-link', 'Search Google for “best crms”', 'https://www.google.com/search?q=best%20crms'])
  assert.deepEqual([buildRows(readTyped('ss', settings), {}, settings, { now })[0].data.app], ['Spotify'])
})

test('one tab shows one source at more length: the clipboard by day, files recent first, pins first', () => {
  const items = [clip('a', 'today one'), clip('b', 'yesterday one', { at: at(28, 8) }), clip('c', 'snippet', { pinned: true, at: at(1, 8) }), clip('d', 'https://osat.example', { kind: 'link' })]
  const board = buildRows(readTyped('', settings, 'clipboard'), { clipboard: { items } }, settings, { now })
  assert.deepEqual(board.map((row) => [row.section, row.title]), [['Pinned', 'snippet'], ['Today', 'today one'], ['Today', 'osat.example'], ['Yesterday', 'yesterday one']])
  const links = buildRows(readTyped('', settings, 'clipboard'), { clipboard: { items } }, settings, { now, clipFilter: 'link' })
  assert.deepEqual(links.map((row) => row.kind), ['link'])
  assert.deepEqual(buildRows(readTyped('yester', settings, 'clipboard'), { clipboard: { items } }, settings, { now }).map((row) => row.title), ['yesterday one'])

  const pinned = cleanSettings({ pins: [{ kind: 'file', rootId: 'desktop', relative: 'Plan.md', name: 'Plan.md', where: 'Desktop' }] }, { validHotkey })
  const recent = [file('New.pdf'), file('Old.pdf')]
  const files = buildRows(readTyped('', pinned, 'files'), { recentFiles: recent }, pinned, { now })
  assert.deepEqual(files.map((row) => [row.section, row.title, row.pinned]), [['Pinned', 'Plan.md', true], ['Recent files', 'New.pdf', false], ['Recent files', 'Old.pdf', false]])
  const searched = buildRows(readTyped('taxes', pinned, 'files'), { files: recent, recentFiles: [file('Other.pdf')] }, pinned, { now })
  assert.deepEqual(searched.map((row) => row.section), ['Files', 'Files'], 'words search; recents step aside')
  const kindOnly = buildRows(readTyped('', pinned, 'files'), { files: recent }, pinned, { now, fileFilter: 'pdf' })
  assert.deepEqual(kindOnly.map((row) => row.title), ['New.pdf', 'Old.pdf'])
  const start = buildRows(readTyped('', pinned, 'all'), { recentFiles: recent, clipboard: { items } }, pinned, { now })
  assert.deepEqual([...new Set(start.map((row) => row.section))], ['Clipboard', 'Pinned', 'Recent files'], 'opened with nothing typed: the latest copies, then pins and recent files')
  const many = Array.from({ length: 9 }, (_, index) => clip(`m${index}`, `copy ${index}`))
  const seeAll = buildRows(readTyped('', settings, 'all'), { clipboard: { items: many } }, settings, { now })
  assert.deepEqual(seeAll.filter((row) => row.kind !== 'more').length, 6)
  assert.deepEqual([seeAll[6].title, seeAll[6].data.scope, actionsFor(seeAll[6])[0].id], ['See all 9 copies', 'clipboard', 'scope'])
})

test('apps: names that start with the words come first', () => {
  const apps = ['Notes', 'Keynote', 'OSAT', 'Notion', 'Music'].map((name) => ({ name, path: `/Applications/${name}.app` }))
  assert.deepEqual(rankApps(apps, 'not').map((app) => app.name), ['Notes', 'Notion', 'Keynote'])
  assert.deepEqual(rankApps(apps, '').map((app) => app.name), ['Keynote', 'Music', 'Notes', 'Notion', 'OSAT'])
  assert.deepEqual(rankApps(apps, 'zzz'), [])
})

test('Return does the obvious thing, and ⌘K lists the rest', () => {
  const [top] = buildRows(readTyped('taxes', settings), { files: [file('Taxes 2025.pdf')] }, settings, { now })
  assert.deepEqual(actionsFor(top, { canAsk: true }).map((action) => action.id), ['open', 'reveal', 'copy-path', 'ask', 'add', 'pin', 'delete'])
  assert.equal(actionsFor(top)[0].keys, '↵')
  assert.equal(actionsFor(top).some((action) => action.id === 'ask'), false, 'Ask only offers what it can read')
  assert.equal(actionsFor({ ...top, pinned: true }).find((action) => action.id === 'pin').label, 'Unpin')
  assert.equal(actionsFor({ kind: 'folder', data: {} })[0].label, 'Open in Files')
  assert.equal(actionsFor(top).find((action) => action.id === 'delete').danger, true)

  const copy = { kind: 'text', data: clip('a', 'hello') }
  assert.deepEqual(actionsFor(copy).map((action) => action.id), ['paste', 'copy', 'add', 'pin', 'delete'])
  assert.equal(actionsFor(copy)[0].label, 'Paste')
  const offered = actionsFor(copy, { offer: { folderId: 'f1', folderName: 'Jordan' } })
  assert.deepEqual(offered.map((action) => action.id), ['paste', 'copy', 'offer', 'add', 'pin', 'delete'])
  assert.equal(offered[2].label, 'Add to Jordan')
  assert.deepEqual(actionsFor({ kind: 'link', data: clip('l', 'https://x.example', { kind: 'link' }) }).map((action) => action.id), ['paste', 'copy', 'open-link', 'add', 'pin', 'delete'])
  assert.deepEqual(actionsFor({ kind: 'image', data: { id: 'i', kind: 'image', pinned: true } }).map((action) => action.label), ['Paste', 'Copy', 'Unpin', 'Delete'])
  assert.equal(actionsFor({ kind: 'app', data: {} })[0].id, 'open-app')
  assert.equal(actionsFor({ kind: 'node', data: {} })[0].label, 'Open on the canvas')
  assert.equal(actionsFor({ kind: 'calc', data: {} })[0].label, 'Copy the answer')
  assert.deepEqual(actionsFor(null), [])
  assert.deepEqual(actionsFor({ kind: 'mystery' }), [])
})

test('the details under the preview say where, what and how big; for a copy, which app and when', () => {
  const [top] = buildRows(readTyped('taxes', settings), { files: [file('Taxes 2025.pdf')] }, settings, { now })
  assert.deepEqual(detailsFor(top, { now }), [['Where', 'Documents › Taxes'], ['Kind', 'PDF document'], ['Size', '1.2 MB'], ['Changed', 'Sep 20, 2026']])
  const copy = { kind: 'text', data: clip('a', 'x'.repeat(1500), { at: new Date(2026, 8, 29, 9, 26).toISOString(), app: 'Safari' }) }
  assert.deepEqual(detailsFor(copy, { now }), [['Kind', 'Text'], ['From', 'Safari'], ['Copied', '4 minutes ago'], ['Length', '1,500 characters']])
  assert.deepEqual(detailsFor({ kind: 'image', data: { kind: 'image', at: at(29, 9), image: { w: 800, h: 600 } } }, { now }).slice(0, 2), [['Kind', 'Image'], ['Size', '800 × 600']])
  assert.deepEqual(detailsFor(null), [])
  assert.equal(fileKind('a.HEIC'), 'Picture')
  assert.equal(fileKind('notes.md'), 'Note')
  assert.equal(fileKind('Plans', true), 'Folder')
  assert.equal(fileKind('weird.abcdefghij'), 'File')
  assert.equal(fileKind('Makefile'), 'File')
  assert.equal(isPicture('a.png'), true)
  assert.equal(isPicture('a.pdf'), false)
  assert.deepEqual([sizeText(0), sizeText(900), sizeText(2048), sizeText(1258291), sizeText(5 * 1024 ** 3), sizeText(NaN)], ['0 B', '900 B', '2 KB', '1.2 MB', '5 GB', ''])
})

test('window layouts: a tab of their own, and "left half" finds one from Everything', () => {
  const keys = cleanSettings({ windows: { on: true } }, { validHotkey })
  const all = buildRows(readTyped('left half', keys), {}, keys, { now })
  assert.deepEqual(all.map((row) => [row.section, row.kind, row.title, row.data.key]), [['Windows', 'layout', 'Left half', 'Control+Alt+Left']])
  assert.deepEqual(buildRows(readTyped('le', keys), {}, keys, { now }), [], 'two letters are too little to offer a layout from Everything')
  assert.deepEqual(buildRows(readTyped('w top', keys), {}, keys, { now }).map((row) => row.title), ['Top half', 'Top left', 'Top right'], 'w is the tab')
  const every = buildRows(readTyped('', keys, 'windows'), {}, keys, { now })
  assert.equal(every.length, 17)
  assert.equal(every.at(-1).title, 'Put it back')
  const off = buildRows(readTyped('left half', settings), {}, settings, { now })
  assert.equal(off[0].data.key, null, 'with window keys off, no key is promised')
  const noWindows = cleanSettings({ sources: { windows: { on: false } } }, { validHotkey })
  assert.deepEqual(buildRows(readTyped('left half', noWindows), {}, noWindows, { now }), [])
  assert.deepEqual(actionsFor(every[0]).map((action) => action.label), ['Move the window', 'Add to favorites', 'Set a key…', 'Set a word…'])
  assert.equal(actionsFor(every.at(-1))[0].label, 'Put the window back')
  assert.deepEqual(detailsFor(all[0]), [['Moves', 'the window you were in'], ['Key', '⌃⌥Left']])
})

 test('emoji and symbols use the native picker without replacing search scopes', () => {
  for (const word of ['emoji', 'symbols']) {
    const row = buildRows(readTyped(word, settings), {}, settings)[0]
    assert.equal(row.kind, 'emoji')
    assert.equal(actionsFor(row)[0].id, 'emoji')
  }
  assert.equal(buildRows(readTyped('emoji', settings, 'files'), {}, settings).some((row) => row.kind === 'emoji'), false)
})

test('one bar: commands come right after an app named by the words, and the words can always be asked or kept', () => {
  const commands = [
    { key: 'room:Notes', label: 'Notes', kind: 'room', go: ['Notes'] },
    { key: 'act:new-note', label: 'New note', also: 'write page', kind: 'action', go: ['Notes', { action: 'new' }] },
    { key: 'act:sticky', label: 'Write a sticky', also: 'sticky note jot', kind: 'action', go: ['Capture'] },
  ]
  // "note" is a whole word of New note and of Write a sticky (actions first, in their order), then the Notes room.
  assert.deepEqual(rankCommands(commands, 'note').map((item) => item.key), ['act:new-note', 'act:sticky', 'room:Notes'])
  assert.deepEqual(rankCommands(commands, 'sticky').map((item) => item.key)[0], 'act:sticky')
  assert.deepEqual(rankCommands(commands, 'no').map((item) => item.key), ['act:new-note', 'act:sticky', 'room:Notes'], 'a start of a word keeps the order')

  const apps = [{ name: 'Notion', path: '/Applications/Notion.app' }, { name: 'Sticky Notes', path: '/Applications/Sticky Notes.app' }]
  const ready = { state: 'ready', label: 'Balanced, on this Mac' }
  const rows = buildRows(readTyped('no', settings), { apps, commands }, settings, { now, ai: ready })
  assert.deepEqual(rows.map((row) => [row.section, row.kind, row.title]), [
    ['Ask', 'ask', 'Ask AI “no”'],
    ['Apps', 'app', 'Notion'],
    ['Commands', 'room', 'Notes'],
    ['Commands', 'room', 'New note'],
    ['Commands', 'room', 'Write a sticky'],
    ['Apps', 'app', 'Sticky Notes'],
    ['Write it down', 'sticky', 'Save as a sticky'],
  ])
  assert.equal(rows[0].subtitle, 'Balanced, on this Mac')
  assert.deepEqual(actionsFor(rows[0]).map((action) => [action.id, action.keys]), [['ask-ai', '↵']])
  assert.deepEqual(actionsFor(rows.at(-1)).map((action) => [action.id, action.keys]), [['sticky', '↵']])
  assert.equal(rows.at(-1).data.text, 'no')
  // The highlight starts on the first thing found; on Ask for a question, or when nothing else was found.
  assert.equal(startRow(rows, readTyped('no', settings)), 1)
  const question = readTyped('how do I export a node?', settings)
  assert.equal(startRow(buildRows(question, { apps }, settings, { now, ai: ready }), question), 0)
  const nothing = readTyped('zebra plans', settings)
  assert.equal(startRow(buildRows(nothing, {}, settings, { now, ai: ready }), nothing), 0)
  const sumAsked = readTyped('what is 2*49?', settings)
  assert.equal(buildRows(sumAsked, {}, settings, { now, ai: ready })[startRow(buildRows(sumAsked, {}, settings, { now, ai: ready }), sumAsked)]?.kind ?? 'ask', 'ask', 'words around a sum are a question')
  const plainSum = readTyped('2*49', settings)
  assert.equal(buildRows(plainSum, {}, settings, { now, ai: ready })[startRow(buildRows(plainSum, {}, settings, { now, ai: ready }), plainSum)].kind, 'calc')
  assert.equal(looksLikeQuestion('summarize what I copied today'), true)
  assert.equal(looksLikeQuestion('what'), false, 'one word is a search')
  assert.equal(looksLikeQuestion('notion'), false)

  // Offline, Ask says whether it waits; nothing typed, or another source, has no such rows.
  const said = (ai) => wordRows(readTyped('plan the trip', settings), ai)[0].subtitle
  assert.match(said({ state: 'waits' }), /waits until you’re back online/)
  assert.match(said({ state: 'ready', label: 'Light', offline: true }), /^Offline, the AI on this Mac still answers · Light$/)
  assert.match(said({ state: 'none' }), /Set up the AI/)
  assert.deepEqual(wordRows(readTyped('', settings), ready), [])
  assert.deepEqual(wordRows(readTyped('x', settings, 'clipboard'), ready), [])
  assert.deepEqual(buildRows(readTyped('no', settings), { apps }, settings, { now }).filter((row) => row.source === 'do'), [], 'only the bar asks for them')

  // ⌘↵ asks and ⌥↵ keeps, whatever the row: the second action moved to ⇧↵.
  for (const row of [{ kind: 'file', data: {} }, { kind: 'text', data: clip('a', 'x') }, { kind: 'image', data: { id: 'i' } }, { kind: 'app', data: {} }, { kind: 'calc', data: {} }]) {
    assert.equal(actionsFor(row).some((action) => action.keys === '⌘↵' || action.keys === '⌥↵'), false, row.kind)
    assert.equal(actionsFor(row)[1].keys, '⇧↵', row.kind)
  }
})

test('anything in the bar can be a favorite, or have its own key and word, set from ⌘K', async () => {
  const { customize, idOf, keysOf, ownKeyOf, ownWordOf, wordsOf, applyPatch } = await import('../shared/launcher-model.mjs')
  const layout = { key: 'layout:left-half', kind: 'layout', title: 'Left half', data: { layout: 'left-half' } }
  const withLayoutKey = cleanSettings(applyPatch(cleanSettings(undefined, { validHotkey }), customize(cleanSettings(undefined, { validHotkey }), layout, { hotkey: 'Control+Alt+Shift+L' })), { validHotkey })
  assert.equal(withLayoutKey.windows.on, false, 'a layout\'s own key never turns every window key on')
  assert.equal(keysOf(withLayoutKey)['row:layout:left-half'], 'Control+Alt+Shift+L')
  const base = cleanSettings(undefined, { validHotkey })
  const room = { key: 'room:Notes', source: 'notes', kind: 'room', title: 'Notes', subtitle: 'Open', section: 'Commands', data: { go: ['Notes', null] } }
  const lock = buildRows(readTyped('lock', base), {}, base, { now }).find((row) => row.kind === 'system')
  assert.deepEqual([lock.title, actionsFor(lock).map((action) => action.id)], ['Lock the screen', ['system', 'favorite', 'set-key', 'set-word']])
  assert.deepEqual(buildRows(readTyped('lo', base), {}, base, { now }), [], 'two letters are too little for the Mac’s commands')

  // Favorite, key and word for a room: kept with the row, shown first on an empty bar, its word finds it.
  let next = cleanSettings(applyPatch(base, customize(base, room, { favorite: true })), { validHotkey })
  next = cleanSettings(applyPatch(next, customize(next, room, { hotkey: 'Control+Alt+N' })), { validHotkey })
  next = cleanSettings(applyPatch(next, customize(next, room, { keyword: 'nn' })), { validHotkey })
  assert.equal(keysOf(next)['row:room:Notes'], 'Control+Alt+N')
  assert.equal(wordsOf(next)['row:room:Notes'], 'nn')
  assert.deepEqual([ownKeyOf(next, room), ownWordOf(next, room), idOf(room)], ['Control+Alt+N', 'nn', 'row:room:Notes'])
  const start = buildRows(readTyped('', next), {}, next, { now })
  assert.deepEqual([start[0].section, start[0].title, start[0].favorite], ['Favorites', 'Notes', true])
  assert.equal(actionsFor(start[0]).find((action) => action.id === 'favorite').label, 'Remove from favorites')
  const byWord = buildRows(readTyped('nn', next), {}, next, { now, ai: { state: 'ready', label: 'AI' } })
  assert.deepEqual([byWord[1].title, byWord[1].section], ['Notes', 'Your word “nn”'], 'after Ask AI, the thing your word names')

  // Taking all three away forgets it; an app keeps its key and word with the apps.
  let off = cleanSettings(applyPatch(next, customize(next, room, { favorite: false })), { validHotkey })
  off = cleanSettings(applyPatch(off, customize(off, room, { hotkey: null })), { validHotkey })
  off = cleanSettings(applyPatch(off, customize(off, room, { keyword: null })), { validHotkey })
  assert.deepEqual(off.custom, [])
  const safari = { key: 'app:/Applications/Safari.app', kind: 'app', title: 'Safari', data: { path: '/Applications/Safari.app' } }
  const withApp = cleanSettings(applyPatch(base, customize(base, safari, { keyword: 'sf' })), { validHotkey })
  assert.equal(withApp.apps.Safari.keyword, 'sf')
  assert.equal(withApp.custom.length, 0)
  // A word already taken is not given twice.
  const taken = cleanSettings(applyPatch(base, customize(base, room, { keyword: 'g' })), { validHotkey })
  assert.equal(ownWordOf(taken, room), null)
})

test('Next screen keeps the window as it is, in the same place in proportion, on the next screen', async () => {
  const { nextScreenFrame } = await import('../shared/window-layouts.mjs')
  const left = { workArea: { x: 0, y: 25, width: 1440, height: 875 } }
  const right = { workArea: { x: 1440, y: 0, width: 2560, height: 1415 } }
  assert.equal(nextScreenFrame({ x: 100, y: 100, width: 800, height: 600 }, [left]), null, 'one screen: nothing moves')
  assert.deepEqual(nextScreenFrame({ x: 0, y: 25, width: 800, height: 600 }, [left, right]), { x: 1440, y: 0, width: 800, height: 600 }, 'at the top left, it stays at the top left')
  assert.deepEqual(nextScreenFrame({ x: 1440 + 2560 - 800, y: 1415 - 600, width: 800, height: 600 }, [left, right]), { x: 640, y: 300, width: 800, height: 600 }, 'from the last screen it wraps to the first, bottom right stays bottom right')
  assert.deepEqual(nextScreenFrame({ x: 1440, y: 0, width: 2560, height: 1415 }, [left, right]), { x: 0, y: 25, width: 1440, height: 875 }, 'too big for the next screen: it fits it')
})
