import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import * as model from '../shared/activity-model.mjs'

const require = createRequire(import.meta.url)
const { createActivity } = require('../desktop/activity.cjs')

const VM = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   896287.
Pages wired down:                             315911.
Pages purgeable:                               31390.
"Translation faults":                    16694997790.
File-backed pages:                           1602772.
Anonymous pages:                             1180629.
Pages occupied by compressor:                 138200.
`
const GB = 1024 ** 3

test('memory the way Activity Monitor counts it: app (less purgeable) + wired + compressed', () => {
  const memory = model.readVmStat(VM)
  assert.equal(memory.app, (1180629 - 31390) * 16384)
  assert.equal(memory.used, memory.app + 315911 * 16384 + 138200 * 16384)
  assert.equal(memory.cached, 1602772 * 16384)
  assert.equal(model.readVmStat('').used, 0)
})

test('pressure, processor, sizes and time in plain words', () => {
  assert.deepEqual([1, 2, 4, 'x'].map(model.pressureOf), ['normal', 'warn', 'critical', 'normal'])
  const cpu = (user, idle) => ({ times: { user, nice: 0, sys: 0, irq: 0, idle } })
  assert.equal(model.cpuBusy([cpu(0, 0), cpu(0, 0)], [cpu(30, 70), cpu(10, 90)]), 0.2)
  assert.equal(model.cpuBusy([], [cpu(1, 1)]), 0)
  assert.deepEqual([500 * 1024 ** 2, 26.3 * GB, 994 * GB].map(model.bytesWords), ['500 MB', '26.3 GB', '994 GB'])
  assert.deepEqual([59, 7200, 90000, 86400].map(model.uptimeWords), ['0 minutes', '2 hours', '1 day, 1 hour', '1 day'])
  assert.equal(model.readMachineName('not json'), '')
  assert.deepEqual(model.readSpecs('Mac17,8\nApple M5 Pro\n27.2\n68719476736\n'), { model: 'Mac17,8', chip: 'Apple M5 Pro', macos: '27.2', memory: 64 * GB })
})

test('the room\'s channels: the Mac now, and Quit only for a running app\'s path', async () => {
  const handlers = {}
  const ended = []
  const exec = async (file, args) => (file.endsWith('vm_stat') ? VM : file.endsWith('system_profiler') ? '{"SPHardwareDataType":[{"machine_name":"MacBook Pro"}]}' : args.length > 2 ? 'Mac17,8\nApple M5 Pro\n27.2\n68719476736' : '2')
  const processes = {
    list: async () => [{ path: '/Applications/Safari.app', name: 'Safari', count: 3, kb: 1024, cpu: 12.5, pids: [1] }],
    end: async (path, { force }) => { ended.push([path, force]); return 1 },
  }
  createActivity({ model, processes, exec, platform: 'darwin', handle: (channel, run, options) => { assert.deepEqual(options, { from: 'app' }); handlers[channel] = run }, fail: (message) => { throw new Error(message) } })
  const now = await handlers['activity:now']()
  assert.equal(now.mac, true)
  assert.equal(now.memory.total, 64 * GB)
  assert.equal(now.specs.chip, 'Apple M5 Pro')
  assert.equal(now.specs.name, 'MacBook Pro')
  assert.equal(now.memory.pressure, 'warn')
  assert.deepEqual(now.apps, [{ path: '/Applications/Safari.app', name: 'Safari', count: 3, bytes: 1024 * 1024, cpu: 12.5 }])
  assert.ok(now.disk.total > 0 && now.disk.free <= now.disk.total)
  assert.equal(await handlers['activity:quit']('/Applications/Safari.app', true), 1)
  assert.deepEqual(ended, [['/Applications/Safari.app', true]])
  await assert.rejects(handlers['activity:quit'](42), /running app/)
})

test('off the Mac it says so instead of guessing', async () => {
  const handlers = {}
  createActivity({ model, processes: { list: async () => [] }, exec: async () => '', platform: 'linux', handle: (channel, run) => { handlers[channel] = run }, fail: () => {} })
  assert.deepEqual(await handlers['activity:now'](), { mac: false })
})
