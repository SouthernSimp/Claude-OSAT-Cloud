const os = require('node:os')

/* Terminal sessions live in the main process so a shell keeps running while
   you visit other rooms. The renderer attaches, gets the recent scrollback,
   and streams from there. The Mac App Store build has no terminal: a sandboxed
   shell cannot do the work people expect of one. */

const SCROLLBACK = 256 * 1024

function createTerminals({ emit }) {
  let pty = null
  try {
    pty = require('node-pty')
  } catch (error) {
    console.error('Terminal unavailable:', error.message)
  }
  const sessions = new Map()
  let seq = 0

  function start({ cols = 100, rows = 30 } = {}) {
    if (!pty) throw new Error('The terminal could not start on this Mac.')
    const id = `term-${++seq}`
    const shell = process.env.SHELL || '/bin/zsh'
    const proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: clamp(cols, 20, 400),
      rows: clamp(rows, 5, 200),
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'OSAT' },
    })
    const session = { id, proc, buffer: '', title: shell.split('/').pop(), alive: true }
    sessions.set(id, session)
    proc.onData((data) => {
      session.buffer = (session.buffer + data).slice(-SCROLLBACK)
      emit('terminal:data', id, data)
    })
    proc.onExit(({ exitCode }) => {
      session.alive = false
      emit('terminal:exit', id, exitCode)
    })
    return info(session)
  }

  const info = (session) => ({ id: session.id, title: session.title, alive: session.alive })

  return {
    available: Boolean(pty),
    list: () => [...sessions.values()].map(info),
    start,
    attach(id) {
      const session = sessions.get(id)
      if (!session) throw new Error('That terminal has closed.')
      return { ...info(session), buffer: session.buffer }
    },
    write(id, data) {
      const session = sessions.get(id)
      if (session?.alive && typeof data === 'string') session.proc.write(data.slice(0, 64 * 1024))
    },
    resize(id, cols, rows) {
      const session = sessions.get(id)
      if (session?.alive) session.proc.resize(clamp(cols, 20, 400), clamp(rows, 5, 200))
    },
    close(id) {
      const session = sessions.get(id)
      if (!session) return
      if (session.alive) session.proc.kill()
      sessions.delete(id)
    },
    destroy() {
      for (const session of sessions.values()) if (session.alive) session.proc.kill()
      sessions.clear()
    },
  }
}

function clamp(value, min, max) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min
}

module.exports = { createTerminals }
