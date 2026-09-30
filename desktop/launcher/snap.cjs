/* Window snapping (Phase 13): move and resize the front window to a half, a third, a corner, the whole screen or the
   middle, and put it back. It asks System Events (AppleScript's JavaScript) for the front window's place and size,
   works out where the layout goes on the screen it is on (shared/window-layouts.mjs), and sets it. That needs OSAT
   to be allowed in Accessibility; without that nothing is touched and `snap` says why (`reason: 'access'`), so the
   words can say what is waiting. OSAT never moves its own windows, and never changes a setting. `exec` and
   `trusted` are passed in, so the tests use stand-ins. */
const { run } = require('../mac-files.cjs')

const FRONT = `function run() {
  const se = Application("System Events")
  const found = se.processes.whose({ frontmost: true })
  if (found.length === 0) return JSON.stringify({ error: "NOFRONT" })
  const front = found[0]
  const windows = front.windows()
  if (windows.length === 0) return JSON.stringify({ error: "NOWINDOW", app: front.name() })
  const at = windows[0].position()
  const size = windows[0].size()
  return JSON.stringify({ app: front.name(), x: at[0], y: at[1], width: size[0], height: size[1] })
}`
const MOVE = `function run(argv) {
  const [x, y, width, height] = argv.map(Number)
  const se = Application("System Events")
  const win = se.processes.whose({ frontmost: true })[0].windows[0]
  win.size = [width, height]
  win.position = [x, y]
  win.size = [width, height]
  return "ok"
}`

function createSnap({ exec = run, platform = process.platform, trusted = () => false, screens = () => [], own = [], layouts }) {
  // Where each app's window was before OSAT moved it, and where OSAT last put it: so Put it back knows.
  const before = new Map()
  const placed = new Map()
  const same = (a, b) => a && b && ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) <= 2)

  return {
    /* Whether OSAT may move windows now (never asks; the one place that asks is Settings → Launcher). */
    allowed: () => platform === 'darwin' && trusted() === true,
    /* → { ok: true, app, layout } or { ok: false, reason: 'access' | 'mac' | 'nowindow' | 'own' | 'nothing' | 'failed' }. */
    async snap(id) {
      if (platform !== 'darwin') return { ok: false, reason: 'mac' }
      if (!trusted()) return { ok: false, reason: 'access' }
      const layout = layouts.layoutById(id)
      if (!layout) return { ok: false, reason: 'nothing' }
      let front
      try {
        front = JSON.parse(await exec('osascript', ['-l', 'JavaScript', '-e', FRONT], { timeout: 5000 }))
      } catch {
        return { ok: false, reason: 'failed' }
      }
      if (front.error) return { ok: false, reason: front.error === 'NOWINDOW' ? 'nowindow' : 'nothing', app: front.app }
      if (own.includes(front.app)) return { ok: false, reason: 'own', app: front.app }
      const now = { x: front.x, y: front.y, width: front.width, height: front.height }
      let frame
      if (id === 'restore') {
        frame = before.get(front.app)
        if (!frame) return { ok: false, reason: 'nothing', app: front.app }
        before.delete(front.app)
      } else {
        const list = screens()
        if (!list.length) return { ok: false, reason: 'failed' }
        const screen = layouts.screenFor(now, list)
        frame = layouts.frameFor(id, screen.workArea || screen)
        // Only the size it had before OSAT's first move is worth going back to.
        if (!same(now, placed.get(front.app))) before.set(front.app, now)
      }
      try {
        await exec('osascript', ['-l', 'JavaScript', '-e', MOVE, String(frame.x), String(frame.y), String(frame.width), String(frame.height)], { timeout: 5000 })
      } catch {
        return { ok: false, reason: 'failed', app: front.app }
      }
      if (id === 'restore') placed.delete(front.app)
      else placed.set(front.app, frame)
      return { ok: true, app: front.app, layout: id }
    },
  }
}

module.exports = { FRONT, MOVE, createSnap }
