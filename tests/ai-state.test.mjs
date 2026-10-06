import assert from 'node:assert/strict'
import test from 'node:test'

import { actionLabel, aiState, engineOf, localModel, WAKE_GIVE_UP_MS, WAKE_SLOW_MS } from '../src/assistant/ai-state.js'

const GB = 1024 ** 3
const tier = (state, extra = {}) => ({ id: 'balanced', ready: true, state, blocked: false, message: '', ...extra })
const built = { id: 'osat:balanced', offline: true, state: 'idle' }
const status = (state, extra = {}) => ({ chosen: 'balanced', tiers: [tier(state, extra)], download: null })

test('every state says something, and the ones that can be fixed say how', () => {
  const cases = [
    [{ models: null }, 'checking', null],
    [{ models: [] }, 'none', 'setup'],
    [{ models: [], offline: true }, 'offline', null],
    [{ models: [], status: { tiers: [], download: { received: 0.42 * GB, total: GB, state: 'running' } } }, 'downloading', 'download'],
    [{ models: [], status: { tiers: [], download: { received: GB / 2, total: GB, state: 'paused' } } }, 'paused', 'resume'],
    [{ models: [], offline: true, status: { tiers: [], download: { received: GB / 2, total: GB, state: 'paused' } } }, 'offline', null],
    [{ models: [], status: { tiers: [], download: { received: 1, total: GB, state: 'failed', message: 'There isn’t enough free space.' } } }, 'download-failed', 'resume'],
    [{ models: [built], model: built, status: status('idle') }, 'asleep', null],
    [{ models: [built], model: built, status: status('idle', { blocked: true }) }, 'asleep', null],
    [{ models: [built], model: built, status: status('loading') }, 'waking', null],
    [{ models: [built], model: built, status: status('unloading') }, 'unloading', null],
    [{ models: [built], model: built, status: status('ready') }, 'ready', null],
    [{ models: [built], model: built, status: status('error', { message: 'The model stopped while starting.' }) }, 'asleep', null],
  ]
  for (const [input, key, action] of cases) {
    const state = aiState(input)
    assert.equal(state.key, key, JSON.stringify(input))
    assert.equal(state.action, action, key)
    assert.ok(state.line.length > 10 && !/undefined|NaN/.test(state.line), `${key}: ${state.line}`)
    if (action) assert.ok(actionLabel(action))
  }
  assert.match(aiState(cases[3][0]).line, /42%/)
  assert.match(aiState(cases[8][0]).line, /memory was freed/)
  assert.match(aiState(cases[12][0]).line, /stopped while starting/)
})

test('without a model the line says what happens instead, and nothing can be asked', () => {
  const none = aiState({ models: [] })
  assert.equal(none.canAsk, false)
  assert.match(none.line, /Matching words suggest homes/)
  assert.doesNotMatch(aiState({ models: [], fallback: '' }).line, /Matching|  /)
  assert.equal(aiState({ models: [built], model: built, status: status('idle') }).canAsk, true, 'asking wakes a resting AI')
  assert.equal(aiState({ models: [built], model: built, status: status('unloading') }).canAsk, false)
})

test('a question out: waking, still waking, then giving up; reading once awake', () => {
  const since = 1_000_000
  const ask = (state, now) => aiState({ models: [built], model: built, status: status(state), job: { since }, now })
  assert.deepEqual([ask('idle', since + 1000).key, ask('idle', since + 1000).busy, ask('idle', since + 1000).action], ['waking', true, 'stop'])
  assert.match(ask('loading', since + WAKE_SLOW_MS + 1).line, /Still waking/)
  assert.equal(ask('loading', since + WAKE_SLOW_MS + 1).giveUp, false)
  const slow = ask('loading', since + WAKE_GIVE_UP_MS)
  assert.deepEqual([slow.key, slow.giveUp, slow.action], ['slow', true, 'retry'])
  assert.equal(ask('ready', since + WAKE_GIVE_UP_MS * 2).key, 'thinking', 'a long answer is never given up on')
  assert.equal(aiState({ models: [{ id: 'lmstudio-model', offline: true }], model: { id: 'lmstudio-model', offline: true }, job: { since }, now: since }).key, 'thinking')
})

test('after a question: a failure says why and offers to try again; giving up says so', () => {
  const failed = aiState({ models: [built], model: built, status: status('idle'), job: { failed: 'The model could not start (not enough memory)' } })
  assert.deepEqual([failed.key, failed.action, failed.canAsk], ['failed', 'retry', true])
  assert.match(failed.line, /^The model could not start \(not enough memory\)\. Matching words/)
  assert.equal(aiState({ models: [built], model: built, job: { slow: true } }).key, 'slow')
})

test('sorting asks only a model on this Mac, and the engine is read from the status', () => {
  const cloud = { id: 'cloud:deepseek:chat', offline: false }
  assert.equal(localModel([cloud, built]), built)
  assert.equal(localModel([cloud]), null)
  assert.equal(localModel(null), null)
  assert.deepEqual(engineOf(status('loading'), built), { state: 'loading', blocked: false, message: '' })
  assert.equal(engineOf(status('ready'), { id: 'lmstudio-model' }), null)
  assert.equal(engineOf(null, built).state, 'idle', 'the model list’s own state when there is no status yet')
})
