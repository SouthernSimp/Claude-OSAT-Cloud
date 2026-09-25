import assert from 'node:assert/strict'
import test from 'node:test'
import {
  focusRemaining,
  normalizeFocusSession,
  pauseFocusSession,
  resumeFocusSession,
  startFocusSession,
} from '../src/focus-session.js'

test('focus sessions start, pause, resume, and expire without losing time', () => {
  const started = startFocusSession(1_000)
  assert.equal(focusRemaining(started, 61_000), 24 * 60_000)
  const paused = pauseFocusSession(started, 61_000)
  assert.deepEqual(paused, { status: 'paused', remainingMs: 24 * 60_000 })
  const resumed = resumeFocusSession(paused, 121_000)
  assert.equal(focusRemaining(resumed, 181_000), 23 * 60_000)
  assert.deepEqual(normalizeFocusSession(resumed, resumed.endsAt), { status: 'idle' })
})
