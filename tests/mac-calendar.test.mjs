import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const { SCRIPT, createMacCalendar } = createRequire(import.meta.url)('../desktop/mac-calendar.cjs')

function setup(answer, platform = 'darwin') {
  const handlers = new Map()
  const calls = []
  const fail = (message) => { throw new Error(message) }
  createMacCalendar({
    handle: (channel, operation) => handlers.set(channel, operation),
    fail,
    platform,
    run: async (command, args) => {
      calls.push([command, args])
      const result = typeof answer === 'function' ? answer(command, args) : answer
      if (result instanceof Error) throw result
      return JSON.stringify(result)
    },
  })
  return { call: (channel, ...args) => handlers.get(channel)(...args), calls }
}

test('the script only ever reads through EventKit and never uses the network', () => {
  assert.match(SCRIPT, /EventKit/)
  assert.doesNotMatch(SCRIPT, /NSURLSession|curl|http/)
})

test('status never asks the Mac and says unavailable off the Mac', async () => {
  const off = setup(() => { throw new Error('should not run') }, 'linux')
  assert.deepEqual(await off.call('maccal:status'), { events: 'unavailable', reminders: 'unavailable' })
  assert.equal(off.calls.length, 0)
  const mac = setup({ events: 'notAsked', reminders: 'denied' })
  assert.deepEqual(await mac.call('maccal:status'), { events: 'notAsked', reminders: 'denied' })
  assert.equal(mac.calls[0][0], 'status')
})

test('a Mac that has not been allowed answers in plain words, and a failure is calm', async () => {
  const notYet = setup({ error: 'notAllowed' })
  await assert.rejects(notYet.call('maccal:calendars'), /Show my Mac’s calendars/)
  const broken = setup(new Error('spawn osascript ENOENT'))
  await assert.rejects(broken.call('maccal:reminders'), /couldn’t be reached/)
  assert.deepEqual(await broken.call('maccal:status'), { events: 'unavailable', reminders: 'unavailable' })
})

test('what the window sends is checked before it reaches the Mac', async () => {
  const { call, calls } = setup({ id: 'x' })
  await assert.rejects(call('maccal:events', { from: 'nope', to: 'nope' }), /Nothing was changed/)
  await assert.rejects(call('maccal:events', { from: '2026-01-01', to: '2027-01-01' }), /Nothing was changed/)
  await assert.rejects(call('maccal:add-event', { calendar: 'c', title: '', start: '2026-09-30T15:00:00Z', end: '2026-09-30T16:00:00Z' }), /Nothing was changed/)
  await assert.rejects(call('maccal:add-reminder', { title: '   ' }), /Nothing was changed/)
  await assert.rejects(call('maccal:remove-event', 42), /Nothing was changed/)
  assert.equal(calls.length, 0)
  await call('maccal:add-reminder', { title: ' Call Sam ', due: 'later' })
  assert.deepEqual(calls[0], ['add-reminder', { title: 'Call Sam', due: '' }])
  await call('maccal:reminder-done', 'r1', true)
  assert.deepEqual(calls[1], ['set-reminder-done', { id: 'r1', done: true }])
  await call('maccal:add-event', { calendar: 'c1', title: 'Dentist', start: '2026-09-30T15:00:00Z', end: '2026-09-30T16:00:00Z' })
  assert.deepEqual(calls[2], ['add-event', { calendar: 'c1', title: 'Dentist', start: '2026-09-30T15:00:00Z', end: '2026-09-30T16:00:00Z', notes: '' }])
})
