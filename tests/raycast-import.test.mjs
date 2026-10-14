import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { applyPatch, cleanSettings, keysOf } from '../shared/launcher-model.mjs'
import { RAYCAST_KEYS, exportKind, fromRaycastQuicklinks, fromRaycastSnippets, keysPatch, mergeImport } from '../shared/raycast-import.mjs'

const { validHotkey } = createRequire(import.meta.url)('../desktop/desk.cjs')
const clean = (value) => cleanSettings(value, { validHotkey })

test('Nate’s Raycast keys all survive OSAT’s own checks, once each, with Hyper N a sticky and Hyper E selected text', () => {
  const before = clean(undefined)
  const after = clean(applyPatch(before, keysPatch(before)))
  const keys = keysOf(after)
  const wanted = [
    ...Object.values(RAYCAST_KEYS.apps).map((app) => app.hotkey),
    ...Object.values(RAYCAST_KEYS.windows.hotkeys),
    ...Object.values(RAYCAST_KEYS.captures.hotkeys),
    RAYCAST_KEYS.selection.hotkey, RAYCAST_KEYS.sources.files.hotkey,
    ...RAYCAST_KEYS.custom.map((row) => row.hotkey),
  ]
  for (const key of wanted) assert.ok(Object.values(keys).includes(key), key)
  const values = Object.values(keys)
  assert.equal(new Set(values).size, values.length, 'no key is held twice')
  assert.equal(keys['row:act:sticky'], 'Control+Alt+Shift+Command+N')
  assert.equal(keys['row:kill'], 'Control+Alt+Shift+Command+K')
  assert.equal(keys.selection, 'Control+Alt+Shift+Command+E')
  assert.equal(keys['capture:text'], 'Control+Alt+Shift+Command+T')
  assert.equal(after.sources.notes.hotkey, null, 'Hyper N left OSAT’s notes list')
  assert.equal(after.apps.Messages.keyword, 'mm')
  assert.equal(after.windows.aliases['left-half'], 'lh')
  // Applied twice it stays the same, and a favorite already on the sticky row is kept.
  const again = clean(applyPatch(after, keysPatch({ ...after, custom: after.custom.map((row) => (row.key === 'act:sticky' ? { ...row, favorite: true } : row)) })))
  assert.equal(again.custom.filter((row) => row.key === 'act:sticky').length, 1)
  assert.equal(again.custom.find((row) => row.key === 'act:sticky').favorite, true)
})

test('Raycast’s exports: snippets and quicklinks are told apart and turned into OSAT’s', () => {
  const snippets = [{ name: 'Home', keyword: '!Home', text: 'Line one{cursor}' }, { name: 'Today', keyword: '!date', text: '{date format="yyyy"}' }, { name: 'Empty', keyword: '!e', text: '  ' }]
  const links = [{ name: 'Desktop', link: '~/Desktop', icon: 'link' }, { name: 'GPT', link: 'https://chatgpt.com/?q={query}' }, { name: 'DDG', link: 'https://duckduckgo.com/?q={argument}' }]
  assert.equal(exportKind(snippets), 'snippets')
  assert.equal(exportKind(links), 'quicklinks')
  assert.equal(exportKind([{ foo: 1 }]), null)
  assert.equal(exportKind('nope'), null)
  const ours = fromRaycastSnippets(snippets)
  assert.deepEqual(ours.map((item) => [item.keyword, item.text]), [['!home', 'Line one'], ['!date', '{date}']])
  assert.deepEqual(fromRaycastQuicklinks(links).map((item) => item.url), ['~/Desktop', 'https://chatgpt.com/?q={query}', 'https://duckduckgo.com/?q={query}'])
  // They survive OSAT's cleaning: every word, every link.
  const merged = mergeImport(clean(undefined), { snippets: ours, links: fromRaycastQuicklinks(links) })
  const saved = clean({ snippets: merged.snippets, links: merged.links })
  assert.deepEqual(saved.snippets.map((item) => item.keyword), ['!home', '!date'])
  assert.equal(saved.links.filter((item) => item.id.startsWith('ray-')).length, 3)
})

test('bringing in twice adds nothing; a word or text already here stays as it is', () => {
  const start = clean({ snippets: [{ id: 'mine', name: 'Mine', keyword: '!home', text: 'my own' }] })
  const once = mergeImport(start, { snippets: fromRaycastSnippets([{ name: 'Home', keyword: '!home', text: 'theirs' }, { name: 'Phone', keyword: '!phone', text: '555' }]), links: fromRaycastQuicklinks([{ name: 'D', link: '~/Desktop' }]) })
  assert.deepEqual(once.added, { snippets: 1, links: 1 })
  assert.equal(once.skipped, 1)
  assert.equal(once.snippets.find((item) => item.keyword === '!home').text, 'my own')
  const twice = mergeImport({ ...start, snippets: once.snippets, links: once.links }, { snippets: fromRaycastSnippets([{ name: 'Phone', keyword: '!phone', text: '555' }]), links: fromRaycastQuicklinks([{ name: 'D', link: '~/Desktop' }]) })
  assert.deepEqual(twice.added, { snippets: 0, links: 0 })
})
