import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { phoneBridge } from '../src/store/bridges.js'

/* Stands in for the iPhone app's Swift side: its own folder, and one shared iCloud. */
function fakeNative(cloud, local = new Map(), available = true) {
  return {
    local,
    async call(type, args) {
      if (type === 'local.read') return local.get(args.name) ?? null
      if (type === 'local.write') { local.set(args.name, args.text); return true }
      if (type === 'cloud.status') return { available }
      if (type === 'cloud.list') {
        const names = new Set()
        for (const key of cloud.keys()) if (key.startsWith(`${args.path}/`)) names.add(key.slice(args.path.length + 1).split('/')[0])
        return [...names]
      }
      if (type === 'cloud.read') return cloud.get(args.path) ?? null
      if (type === 'cloud.write') { cloud.set(args.path, args.text); return true }
      throw new Error(`unknown ${type}`)
    },
    on: () => () => {},
  }
}

const fast = { saveDelay: 1, flushDelay: 1, pullDelay: 1, pollEvery: 60000 }
const note = (id, title) => ({ id, title, markdown: '', tags: [], createdAt: 'x', updatedAt: 'x', folderId: null, pinned: false, archived: false, trashedAt: null })

test('two phones sharing iCloud stay in step, and a phone keeps its notes after a restart', async () => {
  globalThis.window ??= {}
  const cloud = new Map()
  const first = fakeNative(cloud)
  const a = phoneBridge(first, fast)
  await a.load()
  await a.commit([{ t: 'add', c: 'notes', v: note('n1', 'From the first phone'), at: 0 }])
  await sleep(40)
  const b = phoneBridge(fakeNative(cloud), fast)
  const heard = []
  b.onChange((message) => heard.push(message))
  const { doc } = await b.load()
  await sleep(40)
  const titles = [...doc.notes, ...heard.flatMap((m) => (m.ops || []).filter((op) => op.t === 'add').map((op) => op.v))].map((n) => n.title)
  assert.ok(titles.includes('From the first phone'), `the second phone caught up: ${titles}`)
  assert.ok([...cloud.keys()].some((key) => /^Sync\/iphone-[a-z0-9]{8}\/snapshot\.json$/.test(key)))

  // Restart the first phone: its notes come back from its own folder.
  const again = phoneBridge(fakeNative(cloud, first.local), fast)
  const reopened = await again.load()
  assert.deepEqual(reopened.doc.notes.map((n) => n.title), ['From the first phone'])
})

test('without iCloud the phone still keeps notes on itself', async () => {
  globalThis.window ??= {}
  const native = fakeNative(new Map(), new Map(), false)
  const bridge = phoneBridge(native, fast)
  await bridge.load()
  await bridge.commit([{ t: 'add', c: 'notes', v: note('n1', 'Only here'), at: 0 }])
  await sleep(20)
  assert.match(native.local.get('workspace.json'), /Only here/)
})
