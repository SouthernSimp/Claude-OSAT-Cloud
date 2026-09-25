import { useEffect, useRef, useState } from 'react'
import { Plus, TerminalWindow, X } from '@phosphor-icons/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const THEME = {
  background: '#15130f',
  foreground: '#eee8de',
  cursor: '#ec9a61',
  cursorAccent: '#15130f',
  selectionBackground: 'rgba(236, 154, 97, 0.32)',
  black: '#1d1a16', red: '#e0715f', green: '#9fc28a', yellow: '#e5c07b', blue: '#7fa6d8', magenta: '#c49ad6', cyan: '#7cc4c0', white: '#d9d2c6',
  brightBlack: '#6f675c', brightRed: '#f08a78', brightGreen: '#b5d69f', brightYellow: '#f0d08e', brightBlue: '#9bbde6', brightMagenta: '#d6b1e6', brightCyan: '#97d6d2', brightWhite: '#faf6ef',
}

/* Your shell, inside OSAT. Sessions live in the Mac app, so they keep running
   while you visit other rooms, and pick up where they were when you return. */
export function TerminalView({ command }) {
  const bridge = window.osatTerminal
  const [available, setAvailable] = useState(null)
  const [sessions, setSessions] = useState([])
  const [active, setActive] = useState(null)
  const [error, setError] = useState('')
  const host = useRef(null)
  const activeRef = useRef(null)
  activeRef.current = active

  async function refresh(select) {
    const list = await bridge.list()
    setSessions(list)
    if (select) setActive(select)
    return list
  }

  async function start() {
    try {
      const session = await bridge.start({ cols: 100, rows: 30 })
      await refresh(session.id)
    } catch (reason) {
      setError(String(reason?.message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  useEffect(() => {
    if (!bridge) return
    bridge.available().then(async (yes) => {
      setAvailable(yes)
      if (!yes) return
      const list = await refresh()
      if (list.length) setActive(list[list.length - 1].id)
      else start()
    }).catch(() => setAvailable(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (bridge && available && command?.action === 'new-terminal') start()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.at])

  /* One xterm per visible session; the shell itself stays in the Mac app. */
  useEffect(() => {
    if (!bridge || !active || !host.current) return undefined
    const term = new Terminal({
      theme: THEME,
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
      macOptionIsMeta: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    let alive = true
    const resize = () => {
      try {
        fit.fit()
        bridge.resize(active, term.cols, term.rows)
      } catch { /* the room is closing */ }
    }
    bridge.attach(active).then((session) => {
      if (!alive) return
      if (session.buffer) term.write(session.buffer)
      if (!session.alive) term.write('\r\n\x1b[2m[This shell has ended. Open a new one with +.]\x1b[0m\r\n')
      resize()
      term.focus()
    }).catch(() => {})
    const input = term.onData((data) => bridge.write(active, data))
    const offData = bridge.onData((id, data) => { if (id === active) term.write(data) })
    const offExit = bridge.onExit((id) => {
      if (id !== active) return
      term.write('\r\n\x1b[2m[This shell has ended. Open a new one with +.]\x1b[0m\r\n')
      refresh()
    })
    const observer = new ResizeObserver(resize)
    observer.observe(host.current)
    return () => {
      alive = false
      observer.disconnect()
      input.dispose()
      offData()
      offExit()
      term.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  async function close(id) {
    await bridge.close(id)
    const list = await refresh()
    if (activeRef.current === id) setActive(list.length ? list[list.length - 1].id : null)
  }

  if (!bridge || available === false) {
    return (
      <section className="tool-unavailable">
        <TerminalWindow weight="duotone" />
        <h2>{bridge ? 'This edition of OSAT has no terminal.' : 'The terminal lives in the OSAT Mac app.'}</h2>
        <p>{bridge ? 'App Store apps run in a sandbox, where a shell can’t reach the rest of your Mac. The direct-download OSAT has one.' : 'A web page can’t run commands on your Mac. Open OSAT on your Mac to use your shell here.'}</p>
      </section>
    )
  }

  return (
    <section className="terminal">
      <nav className="terminal-tabs" aria-label="Terminals">
        {sessions.map((session, index) => (
          <div key={session.id} className={`terminal-tab ${session.id === active ? 'is-active' : ''} ${session.alive ? '' : 'is-ended'}`}>
            <button type="button" aria-current={session.id === active ? 'page' : undefined} onClick={() => setActive(session.id)}>
              <TerminalWindow /> {session.title} {sessions.length > 1 ? index + 1 : ''}
            </button>
            <button type="button" className="terminal-close" aria-label={`Close ${session.title}`} onClick={() => close(session.id)}><X /></button>
          </div>
        ))}
        <button type="button" className="terminal-new" aria-label="New terminal" title="New terminal (⇧⌘T)" onClick={start}><Plus weight="bold" /></button>
        {error && <span className="terminal-error" role="status">{error}</span>}
      </nav>
      <div className="terminal-host" ref={host} />
      {!active && (
        <div className="terminal-empty">
          <p>No shell is open.</p>
          <button type="button" className="primary-button" onClick={start}><Plus /> Open a terminal</button>
        </div>
      )}
    </section>
  )
}
