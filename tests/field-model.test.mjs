import assert from 'node:assert/strict'
import test from 'node:test'
import { dayPhase, phaseCopy } from '../src/field/field-model.js'

test('day phase follows the clock', () => {
  assert.equal(dayPhase(new Date('2026-09-22T08:00:00')), 'morning')
  assert.equal(dayPhase(new Date('2026-09-22T14:00:00')), 'afternoon')
  assert.equal(dayPhase(new Date('2026-09-22T19:00:00')), 'evening')
  assert.equal(dayPhase(new Date('2026-09-22T23:30:00')), 'night')
  assert.equal(dayPhase(new Date('2026-09-22T02:00:00')), 'night')
})

test('each time of day has its words', () => {
  assert.match(phaseCopy('morning')[0], /morning/)
  assert.equal(phaseCopy('nonsense'), phaseCopy('afternoon'))
})
