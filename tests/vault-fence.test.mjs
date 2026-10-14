/* Passwords (Phase 58): the sealed file stays in its own room. These tests read the sources (like the Offline fence in
   tests/under.test.mjs) and fail if anything else in OSAT can reach the vault, its crypto, or its channels. A new reader has to be
   added here on purpose, with the reason it is safe. */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const rel = (file) => path.relative(repo, file).split(path.sep).join('/')

async function sources(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await sources(full))
    else if (/\.(cjs|mjs|js|jsx)$/.test(entry.name)) files.push(full)
  }
  return files
}
const all = []
for (const dir of ['desktop', 'shared', 'src', 'scripts']) {
  for (const file of await sources(path.join(repo, dir))) all.push({ file: rel(file), text: await readFile(file, 'utf8') })
}
const text = (name) => all.find((item) => item.file === name)?.text ?? assert.fail(`${name} is missing`)

// What may mention each piece of the vault, and why.
const WHO = [
  [/vault-format/, ['desktop/passwords.cjs', 'shared/password-model.mjs', 'shared/vault-format.mjs'], 'the sealed file’s code: only the room’s main side loads it (the model’s only mention is a comment)'],
  [/vault\.json/, ['desktop/passwords.cjs'], 'the file itself'],
  [/passwords\.cjs/, ['desktop/main.cjs', 'desktop/passwords.cjs', 'desktop/conceal.cjs', 'shared/password-model.mjs', 'shared/vault-format.mjs'], 'the room’s main side: only main’s wiring requires it'],
  [/conceal\.cjs/, ['desktop/main.cjs', 'desktop/conceal.cjs', 'desktop/passwords.cjs'], 'the concealed clipboard write'],
  [/passwords:/, ['desktop/passwords.cjs', 'desktop/preload.cjs', 'desktop/main.cjs', 'src/views/Passwords.jsx'], 'the room’s channels'],
  [/osatPasswords/, ['desktop/preload.cjs', 'src/views/Passwords.jsx'], 'the room’s bridge'],
  [/password-model/, ['desktop/passwords.cjs', 'shared/vault-format.mjs', 'src/views/Passwords.jsx', 'shared/password-model.mjs'], 'the pure rules'],
]

test('only the room’s own files mention the vault, its code, its file or its channels', () => {
  const found = []
  for (const { file, text: source } of all) {
    for (const [pattern, allowed, why] of WHO) {
      if (pattern.test(source) && !allowed.includes(file)) found.push(`${file} mentions ${pattern} (${why})`)
    }
  }
  assert.deepEqual(found, [])
})

test('sync, snapshots, the phone folder, Ask, the connector, the agent, webhooks and the overnight and brief jobs never touch it', () => {
  const NEVER = [
    'desktop/sync.cjs', 'shared/sync-core.mjs', 'shared/sync-engine.mjs', 'desktop/store/index.cjs', 'desktop/store/file.cjs', 'shared/store-core.mjs',
    'desktop/phone.cjs', 'desktop/phone-root.cjs', 'desktop/folder-watch.cjs',
    'src/assistant/board-context.js', 'src/assistant/ask-find.js', 'src/assistant/ask-sources.js', 'src/assistant/ask-context.js', 'shared/ask-find.mjs',
    'shared/connector-tools.mjs', 'desktop/bots/connector.cjs', 'desktop/bots/index.cjs',
    'shared/agent.mjs', 'desktop/agent.cjs',
    'desktop/bots/webhooks.cjs', 'shared/webhook-model.mjs',
    'desktop/overnight.cjs', 'shared/overnight-model.mjs', 'desktop/brief.cjs', 'shared/brief-model.mjs',
    'desktop/launcher/clipboard-history.cjs', 'desktop/launcher/index.cjs', 'src/lib/find.js',
  ]
  for (const name of NEVER) {
    const source = text(name)
    assert.doesNotMatch(source, /vault|password-model|passwords\.cjs|osatPasswords|passwords:|conceal\.cjs/i, name)
  }
  // The file sits in the data folder itself, never in store/ (the workspace, its snapshots and its sync state).
  assert.match(text('desktop/passwords.cjs'), /path\.join\(dataDir, 'vault\.json'\)/)
})

test('the vault’s code reaches no network, no program, and prints nothing', () => {
  const FILES = ['desktop/passwords.cjs', 'shared/vault-format.mjs', 'shared/password-model.mjs']
  const NETWORK = /(require|import)\(\s*['"](node:)?(http|https|http2|net|tls|dgram|dns|undici|child_process|cluster|worker_threads|vm)['"]\s*\)|\bfrom\s+['"](node:)?(http|https|http2|net|tls|dgram|dns|undici|child_process|cluster|worker_threads|vm)['"]/
  for (const name of FILES) {
    const source = text(name)
    assert.doesNotMatch(source, NETWORK, `${name} loads a network or program module`)
    assert.doesNotMatch(source, /\bfetch\(|\bnew\s+WebSocket\b|\bXMLHttpRequest\b|\bopenExternal\b|\bspawn\(|\bexec(File|Sync)?\(|\beval\(|new Function\(/, `${name} reaches out or runs something`)
    assert.doesNotMatch(source, /\bconsole\./, `${name} prints`)
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/, `${name} takes what it needs from main`)
  }
  // Exactly these modules, and no others (node:crypto is the only crypto).
  const imports = (name) => [...text(name).matchAll(/(?:require\(\s*|from\s+|import\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]).sort()
  assert.deepEqual(imports('shared/vault-format.mjs'), ['node:crypto', 'node:util'])
  assert.deepEqual(imports('desktop/passwords.cjs'), ['node:crypto', 'node:fs/promises', 'node:path'])
  assert.deepEqual(imports('shared/password-model.mjs'), [], 'the window imports this one: nothing else comes with it')
})

test('the one program the room starts is the concealed clipboard write, fed on stdin and given nothing else', () => {
  const source = text('desktop/conceal.cjs')
  assert.deepEqual([...source.matchAll(/(?:require\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]), ['node:child_process'])
  assert.equal([...source.matchAll(/\brun\(/g)].length, 1)
  assert.match(source, /child\.stdin\.end\(String\(text\)/)
  assert.doesNotMatch(source, /console\./)
  // The words are never part of the command's arguments.
  assert.match(source, /run\('\/usr\/bin\/osascript', \['-l', 'JavaScript', '-e', SCRIPT\]/)
})

test('the window’s bridge offers exactly the room’s channels, and the room’s file has no other way to reach main', () => {
  const bridge = text('desktop/preload.cjs')
  const used = new Set([...bridge.matchAll(/'(passwords:[a-z-]+)'/g)].map((match) => match[1]))
  const registered = new Set([...text('desktop/passwords.cjs').matchAll(/register\('(passwords:[a-z-]+)'/g)].map((match) => match[1]))
  used.delete('passwords:locked') // main tells the window; the window can’t tell main that
  assert.deepEqual([...used].sort(), [...registered].sort())
  // Every one is checked against the desk window like the other rooms.
  assert.match(text('desktop/passwords.cjs'), /\{ from: 'app' \}\)/)
  assert.doesNotMatch(text('desktop/passwords.cjs'), /from: '(any|main)'/)
})
