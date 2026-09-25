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

test('desktop AI uses the native bridge instead of a file URL', async () => {
  const { getLocalModels, sendLocalMessage } = await import('../src/local-ai.js');
  const previous = globalThis.window;
  globalThis.window = { osatLocalAI: {
    models: async () => ({ models: [{ id: 'local-test' }] }),
    chat: async ({ messages }) => ({ response: `Local: ${messages[0].content}` }),
  }};
  try {
    assert.equal((await getLocalModels())[0].id, 'local-test');
    assert.equal(await sendLocalMessage({ model: 'local-test', messages: [{ role: 'user', content: 'Hello' }] }), 'Local: Hello');
  } finally { globalThis.window = previous; }
});
