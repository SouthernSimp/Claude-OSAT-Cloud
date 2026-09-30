import assert from 'node:assert/strict'
import test from 'node:test'

import { calculate } from '../shared/calc.mjs'

const plain = (input) => calculate(input)?.plain ?? null

test('sums answer in place', () => {
  assert.equal(plain('2*49'), '98')
  assert.equal(plain('2 * 49'), '98')
  assert.equal(plain('(3 + 4) * 2'), '14')
  assert.equal(plain('2^10'), '1024')
  assert.equal(plain('2 ^ 3 ^ 2'), '512', 'powers go right to left')
  assert.equal(plain('10 / 4'), '2.5')
  assert.equal(plain('1/3'), '0.333333333333')
  assert.equal(plain('-3 + 5'), '2')
  assert.equal(plain('7 x 6'), '42')
  assert.equal(plain('7 × 6'), '42')
  assert.equal(plain('$12.50 * 4'), '50')
  assert.equal(plain('1e3 + 1'), '1001')
  assert.equal(plain('.5 + .25'), '0.75')
  assert.equal(plain('0.1 + 0.2'), '0.3', 'no floating point noise')
})

test('percentages and functions', () => {
  assert.equal(plain('12% of 80'), '9.6')
  assert.equal(plain('100 + 10%'), '110')
  assert.equal(plain('100 - 25%'), '75')
  assert.equal(plain('50% * 3'), '1.5')
  assert.equal(plain('sqrt(16) + 1'), '5')
  assert.equal(plain('max(3, 9, 4) * 2'), '18')
  assert.equal(plain('round(2.6)+abs(-1)'), '4')
  assert.equal(plain('2*pi').slice(0, 6), '6.2831')
  assert.equal(plain('log(1000)+ln(e)'), '4')
})

test('the answer is written for people, and for copying', () => {
  assert.deepEqual(calculate('1234567 * 2'), { value: 2469134, text: '2,469,134', plain: '2469134' })
  assert.equal(calculate('1e20 * 10').text, '1e+21')
  assert.equal(calculate('1/1e12').text, '1e-12')
})

test('anything that is not a sum answers nothing', () => {
  for (const words of ['', '42', 'pi', 'hello', 'notes on 2 things', '2 things + 3', '2026-09-29', '555-010-2299', '(555) 010-2299', '555 010 2299', '5 / 0', '2 +', '(2', '2)', '1.2.3', 'sqrt(', 'process.exit()', '2**3**', 'x * 2', 'e + f']) {
    assert.equal(calculate(words), null, words)
  }
  assert.equal(calculate(`${'9'.repeat(200)}+1`), null, 'too long to be a sum')
  assert.equal(calculate(`${'('.repeat(40)}1${')'.repeat(40)}+1`), null, 'brackets stop at a sensible depth')
  assert.equal(calculate(12), null)
  assert.equal(calculate(undefined), null)
})
