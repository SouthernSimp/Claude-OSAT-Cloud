import assert from 'node:assert/strict'
import test from 'node:test'
import { focusRemaining, normalizeFocusSession } from '../src/focus-session.js'

// No screen starts a focus timer any more; a workspace that saved one running reads back calmly.
test('a saved focus session keeps its time while it lasts, then rests', () => {
  const running = { status: 'running', endsAt: 1_000 + 25 * 60_000 }
  assert.equal(focusRemaining(running, 61_000), 24 * 60_000)
  assert.deepEqual(normalizeFocusSession({ status: 'paused', remainingMs: 5 }, 0), { status: 'paused', remainingMs: 5 })
  assert.deepEqual(normalizeFocusSession(running, running.endsAt), { status: 'idle' })
  assert.deepEqual(normalizeFocusSession(null), { status: 'idle' })
})
