/* Activity (Phase 93, Power tools → Activity): how the Mac is doing, without opening Activity Monitor. Memory the way
   Activity Monitor counts it (app memory + wired + compressed), memory pressure, the processor's load, the startup
   disk, the Mac's specs and the apps using the most. desktop/activity.cjs reads them; this is the pure part. */

/* `vm_stat` → bytes: { used, app, wired, compressed, cached }. App memory is anonymous pages less purgeable ones;
   cached is file-backed pages (macOS gives them back the moment an app needs them). */
export function readVmStat(text) {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]) || 4096
  const pages = (label) => Number(new RegExp(`^"?${label}"?:\\s+(\\d+)`, 'm').exec(text)?.[1]) || 0
  const app = Math.max(0, pages('Anonymous pages') - pages('Pages purgeable')) * page
  const wired = pages('Pages wired down') * page
  const compressed = pages('Pages occupied by compressor') * page
  return { used: app + wired + compressed, app, wired, compressed, cached: pages('File-backed pages') * page }
}

/* `sysctl kern.memorystatus_vm_pressure_level`: 1 is fine, 2 is getting tight, 4 is tight. */
export const PRESSURE = { 1: 'normal', 2: 'warn', 4: 'critical' }
export const pressureOf = (level) => PRESSURE[Number(level)] || 'normal'
export const PRESSURE_WORDS = { normal: 'Plenty of room', warn: 'Getting full', critical: 'Full: quit an app you aren’t using' }

/* How busy the processor was between two readings of os.cpus(): 0–1. */
export function cpuBusy(before, after) {
  let busy = 0
  let all = 0
  after.forEach((cpu, index) => {
    const was = before?.[index]?.times
    if (!was) return
    const sum = (times) => times.user + times.nice + times.sys + times.irq + times.idle
    all += sum(cpu.times) - sum(was)
    busy += sum(cpu.times) - sum(was) - (cpu.times.idle - was.idle)
  })
  return all > 0 ? Math.min(1, Math.max(0, busy / all)) : 0
}

export function bytesWords(bytes) {
  const gb = bytes / 1024 ** 3
  if (gb >= 100) return `${Math.round(gb)} GB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

export function uptimeWords(seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days) return `${days} ${days === 1 ? 'day' : 'days'}${hours ? `, ${hours} ${hours === 1 ? 'hour' : 'hours'}` : ''}`
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

/* `sysctl -n hw.model machdep.cpu.brand_string kern.osproductversion hw.memsize` → the specs, one value a line. */
export function readSpecs(text) {
  const [model = '', chip = '', macos = '', memory = '0'] = String(text).split('\n').map((line) => line.trim())
  return { model, chip, macos, memory: Number(memory) || 0 }
}

/* `system_profiler SPHardwareDataType -json` → "MacBook Pro", or '' when it can't be read. */
export function readMachineName(text) {
  try { return String(JSON.parse(text).SPHardwareDataType?.[0]?.machine_name || '') } catch { return '' }
}
