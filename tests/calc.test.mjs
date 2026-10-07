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

test('units: lengths, weights, cooking, temperature, time, data and speed, offline', () => {
  const said = (words) => calculate(words)?.text ?? null
  assert.equal(said('5 km in miles'), '3.107 mi')
  assert.equal(said('72 f to c'), '22.22 °C')
  assert.equal(said('100 c to f'), '212 °F')
  assert.equal(said('3 cups in ml'), '709.8 ml')
  assert.equal(said('4 fl oz in ml'), '118.3 ml')
  assert.equal(said('10 lb to kg'), '4.536 kg')
  assert.equal(said('1 gb in mb'), '1,000 MB')
  assert.equal(said('60 mph in km/h'), '96.56 km/h')
  assert.equal(said('90 minutes in hours'), '1.5 h')
  assert.equal(said('2*3 ft in cm'), '182.9 cm', 'the amount can be a sum')
  assert.equal(said('5 km in kg'), null, 'kinds that don’t match are not a conversion')
  assert.equal(said('the tent in the car'), null)
})

test('dates: days until a holiday or a day, days since, a day plus some time', () => {
  const now = new Date(2026, 9, 6, 15) // Tuesday, October 6, 2026
  const ask = (words) => calculate(words, { now })
  assert.deepEqual([ask('days until christmas').text, ask('days until christmas').note], ['80 days', 'Until Friday, December 25, 2026'])
  assert.equal(ask('how many days until thanksgiving?').text, '51 days')
  assert.equal(ask('days until friday').text, '3 days')
  assert.equal(ask('days until 12/25').text, '80 days')
  assert.equal(ask('days until jan 1').note, 'Until Friday, January 1, 2027', 'a day already gone this year is next year’s')
  assert.equal(ask('days since march 3').text, '217 days')
  assert.equal(ask('days between dec 1 and jan 15').text, '45 days')
  assert.equal(ask('weeks until new year').text, '12.4 weeks')
  assert.deepEqual([ask('today + 30 days').text, ask('today + 30 days').note], ['Thursday, November 5, 2026', 'In 30 days'])
  assert.equal(ask('today - 1 week').note, '7 days ago')
  assert.equal(ask('days until someday'), null)
  assert.equal(ask('2026-10-05'), null, 'a date alone is not a sum')
})
