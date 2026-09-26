import assert from 'node:assert/strict'
import test from 'node:test'
import { isLoopbackOrigin, validateLocalChatPayload } from '../src/local-ai.js'

test('local AI accepts loopback origins and validates chat roles', () => {
  assert.equal(isLoopbackOrigin('http://127.0.0.1:5173'), true)
  assert.equal(isLoopbackOrigin('https://example.com'), false)
  assert.deepEqual(validateLocalChatPayload({ model: 'local/model', messages: [{ role: 'user', content: 'hi' }] }), {
    model: 'local/model', messages: [{ role: 'user', content: 'hi' }],
  })
  assert.throws(() => validateLocalChatPayload({ model: 'https://example.com/model', messages: [{ role: 'user', content: 'hi' }] }))
  assert.throws(() => validateLocalChatPayload({ model: 'local/model', messages: [{ role: 'tool', content: 'hi' }] }))
})

test('desktop AI lists models and streams through the native bridge', async () => {
  const { getLocalModels, streamLocalMessage } = await import('../src/local-ai.js')
  const previous = globalThis.window
  globalThis.window = { osatLocalAI: {
    models: async () => ({ models: [{ id: 'osat:light' }] }),
    chatStream: ({ messages }, onDelta) => {
      onDelta('Local: ')
      onDelta(messages[0].content)
      return { done: Promise.resolve(`Local: ${messages[0].content}`), cancel: () => {} }
    },
  } }
  try {
    assert.equal((await getLocalModels())[0].id, 'osat:light')
    const parts = []
    assert.equal(await streamLocalMessage({ model: 'osat:light', messages: [{ role: 'user', content: 'Hello' }], onDelta: (text) => parts.push(text) }), 'Local: Hello')
    assert.deepEqual(parts, ['Local: ', 'Hello'])
  } finally { globalThis.window = previous }
})
