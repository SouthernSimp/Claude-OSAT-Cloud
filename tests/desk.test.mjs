import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { accentCss, deskAction, displayAt, hotkeyLabel, validHotkey, windowSpot } = createRequire(import.meta.url)('../desktop/desk.cjs')

test('the desk opens on the display under the cursor', () => {
  const left = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } }
  const right = { id: 2, bounds: { x: 1440, y: -200, width: 2560, height: 1440 } }
  assert.equal(displayAt([left, right], { x: 2000, y: 100 }).id, 2)
  assert.equal(displayAt([left, right], { x: 10, y: 10 }).id, 1)
  assert.equal(displayAt([left, right], { x: -50, y: 5000 }).id, 1)
})

test('the window opens where it was left while that is mostly on a screen, else in the middle of the screen under the cursor', () => {
  const laptop = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 33, width: 1512, height: 949 } }
  const big = { bounds: { x: 1512, y: 0, width: 2560, height: 1440 }, workArea: { x: 1512, y: 25, width: 2560, height: 1415 } }
  const left = { x: 1700, y: 100, width: 1100, height: 760 }
  assert.deepEqual(windowSpot(left, [laptop, big], { x: 10, y: 10 }), left)
  // The big screen unplugged: back in the middle of the laptop's.
  assert.deepEqual(windowSpot(left, [laptop], { x: 10, y: 10 }), { x: 116, y: 98, width: 1280, height: 820 })
  // Nothing saved, a small screen: what fits.
  const small = { bounds: { x: 0, y: 0, width: 1280, height: 800 }, workArea: { x: 0, y: 25, width: 1280, height: 775 } }
  assert.deepEqual(windowSpot(null, [small], { x: 5, y: 5 }), { x: 20, y: 45, width: 1240, height: 735 })
  assert.deepEqual(windowSpot({ x: 0, y: 0, width: 'big' }, [small], { x: 5, y: 5 }).width, 1240)
})

test('no window makes the Mac’s Dock jump: every setVisibleOnAllWorkspaces skips the process transform', async () => {
  const { readdir, readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const dir = fileURLToPath(new URL('../desktop/', import.meta.url))
  const sources = []
  const walk = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(`${folder}${entry.name}/`)
      else if (/^[^ ]+\.cjs$/.test(entry.name)) sources.push(await readFile(`${folder}${entry.name}`, 'utf8'))
    }
  }
  await walk(dir)
  const calls = sources.flatMap((source) => source.match(/setVisibleOnAllWorkspaces\([^)]*\)/g) || [])
  assert.ok(calls.length >= 4, `found ${calls.length}`)
  for (const call of calls) assert.match(call, /skipTransformProcessType: true/, call)
})

test('a hotkey needs a modifier and one key', () => {
  for (const good of ['Alt+Space', 'Control+Shift+O', 'Command+Alt+K', 'Alt+F5', 'Control+1']) assert.equal(validHotkey(good), true, good)
  for (const bad of ['Space', 'Alt', 'Alt+Alt+K', 'Hyper+K', 'Alt+Enter+K', '', null, 'CommandOrControl+K']) assert.equal(validHotkey(bad), false, String(bad))
  assert.equal(hotkeyLabel('Alt+Space'), '⌥Space')
  assert.equal(hotkeyLabel('Command+Shift+K'), '⌘⇧K')
})

test('⌥Space shows the desk, brings it forward, or puts it away', () => {
  assert.equal(deskAction({ visible: false, focused: false }), 'show')
  assert.equal(deskAction({ visible: true, focused: false }), 'show')
  assert.equal(deskAction({ visible: true, focused: true }), 'hide')
})

test('the Mac’s accent colour becomes the page’s, with text that reads on it', () => {
  assert.equal(accentCss('007AFFFF'), ':root { --mac-accent: #007aff; --mac-accent-ink: #ffffff; }')
  assert.match(accentCss('ffcc00ff'), /--mac-accent-ink: #1d1d1f/, 'dark text on yellow')
  assert.equal(accentCss(''), '')
  assert.equal(accentCss('not a colour'), '')
})
