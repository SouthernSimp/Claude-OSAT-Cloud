/* Activity (Phase 93, Power tools → Activity): how this Mac is doing, read with the Mac's own vm_stat and sysctl,
   Node's os and statfs, and the bar's running-apps list (processes.cjs). Quit asks an app to quit (Force quit ends
   it), by the path the list gave, so a made-up path ends nothing. Read-only otherwise; nothing leaves the Mac.
     activity:now → { memory, cpu, disk, specs, apps } · activity:quit (path, force) → how many processes */
const fs = require('node:fs')
const os = require('node:os')

function createActivity({ model, processes, exec, handle, fail, platform = process.platform }) {
  let cpus = os.cpus()
  let specs = null

  async function now() {
    if (platform !== 'darwin') return { mac: false }
    const [vm, pressure, info, disk, apps] = await Promise.all([
      exec('/usr/bin/vm_stat', []),
      exec('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']).catch(() => '1'),
      specs || Promise.all([
        exec('/usr/sbin/sysctl', ['-n', 'hw.model', 'machdep.cpu.brand_string', 'kern.osproductversion', 'hw.memsize']).then(model.readSpecs),
        // "MacBook Pro" rather than "Mac17,8"; read once.
        exec('/usr/sbin/system_profiler', ['SPHardwareDataType', '-json']).then(model.readMachineName, () => ''),
      ]).then(([read, name]) => ({ ...read, name })),
      fs.promises.statfs(fs.existsSync('/System/Volumes/Data') ? '/System/Volumes/Data' : '/'),
      processes.list(),
    ])
    specs = info
    const fresh = os.cpus()
    const busy = model.cpuBusy(cpus, fresh)
    cpus = fresh
    const total = specs.memory || os.totalmem()
    return {
      mac: true,
      memory: { total, ...model.readVmStat(vm), pressure: model.pressureOf(pressure.trim()) },
      cpu: { busy, cores: fresh.length },
      disk: { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize },
      specs: { ...specs, cores: fresh.length, uptime: os.uptime() },
      apps: apps.slice(0, 12).map(({ path, name, count, kb, cpu }) => ({ path, name, count, bytes: kb * 1024, cpu })),
    }
  }

  handle('activity:now', now, { from: 'app' })
  handle('activity:quit', async (appPath, force) => {
    if (typeof appPath !== 'string' || appPath.length > 1024) fail('That isn’t a running app.')
    return processes.end(appPath, { force: force === true })
  }, { from: 'app' })
  return { now }
}

module.exports = { createActivity }
