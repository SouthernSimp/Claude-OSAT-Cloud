import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import test from 'node:test'

/* The real preload, with a stand-in Electron: what it exposes, and a fake IPC to drive. */
function loadPreload() {
  const exposed = {}
  const listeners = new Map()
  const pending = []
  const ipcRenderer = {
    on: (channel, fn) => listeners.set(channel, [...(listeners.get(channel) || []), fn]),
    removeListener: (channel, fn) => listeners.set(channel, (listeners.get(channel) || []).filter((item) => item !== fn)),
    invoke: (...args) => new Promise((resolve) => pending.push({ args, resolve })),
    send: () => {},
    sendSync: () => ({}),
  }
  const electron = { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } }, ipcRenderer, webUtils: { getPathForFile: () => '' } }
  const original = Module._load
  Module._load = function load(request, ...rest) { return request === 'electron' ? electron : original.call(this, request, ...rest) }
  try {
    const require = createRequire(import.meta.url)
    delete require.cache[require.resolve('../desktop/preload.cjs')]
    require('../desktop/preload.cjs')
  } finally {
    Module._load = original
  }
  const emit = (channel, text) => (listeners.get(channel) || []).forEach((fn) => fn({}, text))
  return { exposed, pending, emit }
}

test('a streamed answer never loses its last piece when the answer comes back first', async () => {
  const { exposed, pending, emit } = loadPreload()
  const heard = []
  const run = exposed.osatLocalAI.chatStream({ model: 'cloud:x:y', messages: [] }, (text) => heard.push(text))
  const [{ args, resolve }] = pending.filter((call) => call.args[0] === 'local-ai:chat-stream')
  const channel = `local-ai:delta:${args[1]}`
  emit(channel, 'From the ')
  resolve('From the cloud model') // the reply overtakes the last piece
  assert.equal(await run.done, 'From the cloud model')
  emit(channel, 'cloud model') // arriving late: already handed over, never twice
  assert.deepEqual(heard, ['From the ', 'cloud model'])
})

test('a streamed answer that arrived whole adds nothing; a stopped one adds nothing', async () => {
  const { exposed, pending, emit } = loadPreload()
  const heard = []
  const whole = exposed.osatLocalAI.chatStream({ model: 'osat:x', messages: [] }, (text) => heard.push(text))
  const first = pending.at(-1)
  emit(`local-ai:delta:${first.args[1]}`, 'All ')
  emit(`local-ai:delta:${first.args[1]}`, 'here')
  first.resolve('All here')
  await whole.done
  const stopped = exposed.osatLocalAI.chatStream({ model: 'osat:x', messages: [] }, (text) => heard.push(text))
  pending.at(-1).resolve('')
  await stopped.done
  assert.deepEqual(heard, ['All ', 'here'])
})
