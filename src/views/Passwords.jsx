import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, DiceFive, DotsThree, Eye, EyeSlash, Key, LockSimple, PencilSimple, Plus, Trash, Warning } from '@phosphor-icons/react'

import { cleanError } from '../assistant/useAi.js'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { AUTO_LOCK_CHOICES, CANT_RECOVER, REVEAL_MS, findEntries, strengthOf, waitWords } from '../../shared/password-model.mjs'
import '../styles/passwords.css'

/* Tools → Passwords (Phase 58; main holds everything secret). Locked until the master password; this page only ever holds titles and
   usernames. A password comes here when asked: Reveal (hidden again after ten seconds) or, for Copy, never (main puts it on the
   clipboard). Leaving the room, or anything that locks, drops everything this page knew. Only in the Mac app. */
export function PasswordsView() {
  const bridge = window.osatPasswords
  if (!bridge) return <p className="pop-gone">Your passwords show here in OSAT on your Mac.</p>
  return <PasswordsRoom bridge={bridge} />
}

function PasswordsRoom({ bridge }) {
  const [status, setStatus] = useState(null)
  const [list, setList] = useState(null)
  const [problem, setProblem] = useState('')

  const look = useCallback(() => {
    bridge.status().then((next) => {
      setStatus(next)
      if (next.unlocked) bridge.list().then(setList, () => setList(null))
      else setList(null)
    }, (error) => setProblem(cleanError(error)))
  }, [bridge])

  useEffect(() => {
    look()
    const off = bridge.onLocked?.(() => { setList(null); setStatus((now) => (now ? { ...now, unlocked: false } : now)) })
    // Leaving the room locks it.
    return () => { off?.(); bridge.lock().catch(() => {}) }
  }, [bridge, look])

  if (!status) return <p className="pop-gone">{problem || 'Opening…'}</p>
  const opened = (next) => { setList(next); setProblem(''); setStatus((now) => ({ ...now, exists: true, unlocked: true })); look() }
  if (!status.exists) return <Setup bridge={bridge} onOpened={opened} />
  if (!status.unlocked || !list) return <Locked bridge={bridge} status={status} onOpened={opened} />
  return <Open bridge={bridge} status={status} list={list} setList={setList} onStatus={look} />
}

/* ---- First time: choose the master password ---- */

function Setup({ bridge, onOpened }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [backup, setBackup] = useState(false)
  const strength = strengthOf(password)
  const matches = password === again
  if (backup) return <Frame><ImportBackup bridge={bridge} onDone={(result) => onOpened(result.list)} onBack={() => setBackup(false)} first /></Frame>

  async function create(event) {
    event.preventDefault()
    setBusy(true)
    setProblem('')
    try {
      onOpened(await bridge.create(password, again))
    } catch (error) {
      setProblem(cleanError(error))
    } finally {
      setPassword('')
      setAgain('')
      setBusy(false)
    }
  }
  return (
    <Frame>
      <form className="pw-card" onSubmit={create}>
        <Key aria-hidden="true" className="pw-mark" />
        <h2>Choose a master password</h2>
        <p>It’s the one password you’ll remember. Your passwords stay locked behind it, on this Mac only.</p>
        <p className="pw-warn">{CANT_RECOVER}</p>
        <label>Master password
          <input type="password" autoComplete="new-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {password && <p className={`pw-hint is-level-${strength.level}`} role="status">{strength.label}</p>}
        <label>Type it again
          <input type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
        </label>
        {again && !matches && <p className="pw-hint is-level-0" role="status">They don’t match yet.</p>}
        {problem && <p className="pw-said is-problem" role="alert"><Warning /> {problem}</p>}
        <button type="submit" className="primary-button" disabled={busy || !strength.ok || !matches}>{busy ? 'Creating…' : 'Create'}</button>
        <button type="button" className="ghost-button" onClick={() => setBackup(true)}>I have a backup</button>
      </form>
    </Frame>
  )
}

/* ---- Locked: one field and Unlock ---- */

function Locked({ bridge, status, onOpened }) {
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [until, setUntil] = useState(status.waitMs ? Date.now() + status.waitMs : 0)
  const [now, setNow] = useState(Date.now())
  const waiting = Math.max(0, until - now)
  useEffect(() => {
    if (!until) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])

  async function unlock(event) {
    event.preventDefault()
    setBusy(true)
    setProblem('')
    try {
      onOpened(await bridge.unlock(password))
    } catch (error) {
      setProblem(cleanError(error))
      bridge.status().then((next) => { setNow(Date.now()); setUntil(next.waitMs ? Date.now() + next.waitMs : 0) }, () => {})
    } finally {
      setPassword('')
      setBusy(false)
    }
  }
  return (
    <Frame>
      <form className="pw-card" onSubmit={unlock}>
        <LockSimple aria-hidden="true" className="pw-mark" />
        <h2>Your passwords are locked</h2>
        <label>Master password
          <input type="password" autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {waiting > 0 && <p className="pw-said" role="status">{waitWords(waiting)}</p>}
        {problem && waiting <= 0 && <p className="pw-said is-problem" role="alert"><Warning /> {problem}</p>}
        <button type="submit" className="primary-button" disabled={busy || !password || waiting > 0}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        <p className="pw-quiet">Forgotten it? It can’t be recovered. A backup file still needs its own master password.</p>
      </form>
    </Frame>
  )
}

const Frame = ({ children }) => <div className="pw-room is-plain">{children}</div>

/* ---- Open: the list, and one entry at a time ---- */

function Open({ bridge, status, list, setList, onStatus }) {
  const [query, setQuery] = useState('')
  const [pickedId, setPickedId] = useState(null)
  const [editing, setEditing] = useState(null) // null, 'new' or an id
  const [panel, setPanel] = useState(null) // null, 'more', 'master', 'import'
  const [problem, setProblem] = useState('')
  const [toast, showUndo] = useUndoToast()
  const lastTouch = useRef(0)

  // Using the room keeps it open (main starts the wait again), at most every ten seconds.
  const touch = () => {
    const now = Date.now()
    if (now - lastTouch.current > 10000) { lastTouch.current = now; bridge.touch().catch(() => {}) }
  }
  const shown = findEntries(list, query)
  const picked = list.find((item) => item.id === pickedId) || null
  const idle = !picked && editing === null && !panel
  const failed = (error) => { setProblem(cleanError(error)); onStatus() }

  async function remove(entry) {
    try {
      const result = await bridge.remove(entry.id)
      setList(result.list)
      setPickedId(null)
      showUndo(`Deleted “${entry.title}”`, () => bridge.restore(entry.id).then((next) => { setList(next); setPickedId(entry.id) }, failed))
    } catch (error) { failed(error) }
  }

  /* From Chrome or Apple Passwords (Phase 102): one toast, and Undo takes them all out again. */
  function imported(result) {
    setList(result.list)
    setPanel(null)
    const count = result.added.length
    const undo = count ? () => bridge.remove(result.added).then((next) => setList(next.list), failed) : undefined
    showUndo(`${count ? `Added ${count}` : 'Nothing new to add'}${result.binned ? ' · the file is in the Bin' : ''}`, undo)
    if (!result.binned) setProblem(`OSAT couldn’t move “${result.name}” to the Bin. Please move it there yourself: it has your passwords in plain words.`)
  }

  return (
    <div className="pw-room" onKeyDownCapture={touch} onPointerDownCapture={touch}>
      <header className="pw-bar">
        <input type="search" aria-label="Find a password" placeholder="Find a password" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className={idle ? 'primary-button' : 'outline-button'} onClick={() => { setEditing('new'); setPanel(null); setPickedId(null) }}><Plus /> New password</button>
        <button type="button" className="outline-button" onClick={() => bridge.lock().then(() => onStatus())}><LockSimple /> Lock</button>
        <button type="button" className="outline-button" aria-label="More" aria-expanded={panel === 'more'} onClick={() => { setPanel(panel ? null : 'more'); setEditing(null); setPickedId(null) }}><DotsThree weight="bold" /></button>
      </header>
      {problem && <p className="pw-said is-problem" role="alert"><Warning /> {problem}</p>}
      <div className="pw-body">
        <ul className="pw-list" aria-label="Your passwords">
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" aria-current={item.id === pickedId ? 'true' : undefined} onClick={() => { setPickedId(item.id); setEditing(null); setPanel(null); setProblem('') }}>
                <strong>{item.title}</strong>
                <small>{item.username || item.url || ' '}</small>
              </button>
            </li>
          ))}
          {!shown.length && <li className="pw-quiet">{list.length ? 'Nothing matches.' : 'No passwords yet.'}</li>}
        </ul>
        <section className="pw-detail">
          {editing !== null && (
            <EntryForm
              key={editing}
              bridge={bridge}
              entry={editing === 'new' ? null : list.find((item) => item.id === editing)}
              onSaved={(result) => { setList(result.list); setPickedId(result.id); setEditing(null) }}
              onCancel={() => setEditing(null)}
              onFailed={failed}
            />
          )}
          {editing === null && panel === 'more' && <More bridge={bridge} status={status} onStatus={onStatus} onPanel={setPanel} showUndo={showUndo} onFailed={failed} onImported={imported} />}
          {editing === null && panel === 'master' && <ChangeMaster bridge={bridge} onDone={() => { setPanel('more'); showUndo('Your master password is changed.') }} onBack={() => setPanel('more')} />}
          {editing === null && panel === 'import' && <ImportBackup bridge={bridge} onDone={(result) => { setList(result.list); setPanel(null); showUndo(result.added ? `Added ${result.added} from the backup.` : 'Everything in that backup is already here.') }} onBack={() => setPanel('more')} />}
          {editing === null && !panel && picked && <Entry key={picked.id} bridge={bridge} entry={picked} onEdit={() => setEditing(picked.id)} onRemove={() => remove(picked)} showUndo={showUndo} onFailed={failed} />}
          {idle && (
            <div className="pw-empty">
              <Key aria-hidden="true" />
              <p>{list.length ? 'Pick one to see it.' : 'Add the first one with New password, or bring yours from Chrome or Apple Passwords under More.'}</p>
              <p className="pw-quiet">Locks itself after {status.autoLockMinutes} minutes without use.</p>
            </div>
          )}
        </section>
      </div>
      {toast}
    </div>
  )
}

function Entry({ bridge, entry, onEdit, onRemove, showUndo, onFailed }) {
  const [shown, setShown] = useState(null)

  // A revealed password hides itself after ten seconds, and when you move on.
  useEffect(() => {
    if (shown === null) return undefined
    const timer = setTimeout(() => setShown(null), REVEAL_MS)
    return () => clearTimeout(timer)
  }, [shown])

  const reveal = () => bridge.reveal(entry.id).then(setShown, onFailed)
  const copy = () => bridge.copy(entry.id).then((result) => showUndo(`Copied. It leaves the clipboard in ${result.clearsInSeconds} seconds.`), onFailed)
  const copyName = () => navigator.clipboard?.writeText(entry.username).then(() => showUndo('Copied the username.'), () => {})
  return (
    <article className="pw-entry">
      <h3>{entry.title}</h3>
      <dl>
        {entry.username && <div><dt>Username</dt><dd>{entry.username} <button type="button" className="ghost-button" aria-label="Copy username" onClick={copyName}><Copy /></button></dd></div>}
        {entry.url && <div><dt>Web address</dt><dd>{entry.url}</dd></div>}
        <div>
          <dt>Password</dt>
          <dd className="pw-secret" aria-live="polite">
            {shown === null ? <span aria-label="Hidden">••••••••••</span> : <code>{shown}</code>}
            <button type="button" className="ghost-button" aria-label={shown === null ? 'Reveal password' : 'Hide password'} onClick={() => (shown === null ? reveal() : setShown(null))}>{shown === null ? <Eye /> : <EyeSlash />}</button>
          </dd>
          {shown !== null && <p className="pw-quiet">Hides itself in 10 seconds.</p>}
        </div>
      </dl>
      <div className="pw-actions">
        <button type="button" className="primary-button" onClick={copy}><Copy /> Copy password</button>
        <button type="button" className="outline-button" onClick={onEdit}><PencilSimple /> Edit</button>
        <button type="button" className="ghost-button" onClick={onRemove}><Trash /> Delete</button>
      </div>
    </article>
  )
}

function EntryForm({ bridge, entry, onSaved, onCancel, onFailed }) {
  const [form, setForm] = useState({ title: entry?.title || '', username: entry?.username || '', url: entry?.url || '', password: '' })
  const [show, setShow] = useState(false)
  const [length, setLength] = useState(20)
  const [symbols, setSymbols] = useState(true)
  const [words, setWords] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (key) => (event) => setForm((now) => ({ ...now, [key]: event.target.value }))

  async function make() {
    try {
      const made = await bridge.generate(words ? { words: 6 } : { length, symbols })
      setForm((now) => ({ ...now, password: made }))
      setShow(true)
    } catch (error) { onFailed(error) }
  }
  async function save(event) {
    event.preventDefault()
    setBusy(true)
    try {
      onSaved(await bridge.save({ id: entry?.id, title: form.title, username: form.username, url: form.url, password: form.password }))
    } catch (error) {
      setBusy(false)
      onFailed(error)
    }
  }
  return (
    <form className="pw-form" onSubmit={save}>
      <h3>{entry ? 'Edit password' : 'New password'}</h3>
      <label>Name<input type="text" autoFocus value={form.title} onChange={set('title')} /></label>
      <label>Username<input type="text" autoComplete="off" value={form.username} onChange={set('username')} /></label>
      <label>Web address<input type="text" autoComplete="off" value={form.url} onChange={set('url')} /></label>
      <label>Password
        <span className="pw-field">
          <input type={show ? 'text' : 'password'} autoComplete="off" value={form.password} placeholder={entry ? 'Leave empty to keep the current one' : ''} onChange={set('password')} />
          <button type="button" className="ghost-button" aria-label={show ? 'Hide what I typed' : 'Show what I typed'} onClick={() => setShow(!show)}>{show ? <EyeSlash /> : <Eye />}</button>
        </span>
      </label>
      <div className="pw-make">
        <button type="button" className="outline-button" onClick={make}><DiceFive /> Make one</button>
        <label className={words ? 'is-off' : ''}>Length {length}<input type="range" min="12" max="64" value={length} disabled={words} onChange={(event) => setLength(Number(event.target.value))} /></label>
        <label className="pw-check"><input type="checkbox" checked={symbols} disabled={words} onChange={(event) => setSymbols(event.target.checked)} /> Symbols</label>
        <label className="pw-check"><input type="checkbox" checked={words} onChange={(event) => setWords(event.target.checked)} /> Words instead</label>
      </div>
      <div className="pw-actions">
        <button type="submit" className="primary-button" disabled={busy || !form.title.trim() || (!entry && !form.password)}>Save</button>
        <button type="button" className="ghost-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

/* ---- More: the lock time, a backup, passwords from Chrome or Apple, a new master password ---- */

function More({ bridge, status, onStatus, onPanel, showUndo, onFailed, onImported }) {
  const backup = () => bridge.exportBackup().then((name) => name && showUndo(`Saved ${name}. It can only be opened with your master password.`), onFailed)
  const fromExport = () => bridge.importCsv().then((result) => result && onImported(result), onFailed)
  const setLock = (event) => bridge.setAutoLock(Number(event.target.value)).then(onStatus, onFailed)
  return (
    <div className="pw-more">
      <h3>More</h3>
      <label>Lock after<select value={status.autoLockMinutes} onChange={setLock}>{AUTO_LOCK_CHOICES.map((minutes) => <option key={minutes} value={minutes}>{minutes} {minutes === 1 ? 'minute' : 'minutes'} without use</option>)}</select></label>
      <p className="pw-quiet">It also locks when your Mac sleeps or locks, when OSAT’s window is put away, and when you close this.</p>
      <div className="pw-actions is-stacked">
        <button type="button" className="outline-button" onClick={backup}>Back up…</button>
        <button type="button" className="outline-button" onClick={() => onPanel('import')}>Add from a backup…</button>
        <button type="button" className="outline-button" onClick={fromExport}>Add from Chrome or Apple Passwords…</button>
        <button type="button" className="outline-button" onClick={() => onPanel('master')}>Change master password…</button>
      </div>
      <p className="pw-quiet">From Chrome or Apple Passwords, export them first. Chrome: Password Manager → Settings → Export passwords. Apple Passwords: File → Export All Passwords. Once they’re in, the file goes to the Bin.</p>
      <p className="pw-quiet">A backup is an encrypted copy of your passwords. Nothing readable is ever saved, and there’s no plain-text export.</p>
    </div>
  )
}

function ChangeMaster({ bridge, onDone, onBack }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const strength = strengthOf(next)
  async function change(event) {
    event.preventDefault()
    setBusy(true)
    setProblem('')
    try {
      await bridge.changeMaster(current, next, again)
      onDone()
    } catch (error) {
      setProblem(cleanError(error))
      setBusy(false)
    } finally {
      setCurrent('')
      setNext('')
      setAgain('')
    }
  }
  return (
    <form className="pw-form" onSubmit={change}>
      <h3>Change master password</h3>
      <label>Current master password<input type="password" autoComplete="current-password" autoFocus value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
      <label>New master password<input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></label>
      {next && <p className={`pw-hint is-level-${strength.level}`} role="status">{strength.label}</p>}
      <label>Type it again<input type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} /></label>
      <p className="pw-warn">{CANT_RECOVER}</p>
      {problem && <p className="pw-said is-problem" role="alert"><Warning /> {problem}</p>}
      <div className="pw-actions">
        <button type="submit" className="primary-button" disabled={busy || !current || !strength.ok || next !== again}>Change</button>
        <button type="button" className="ghost-button" onClick={onBack}>Cancel</button>
      </div>
    </form>
  )
}

function ImportBackup({ bridge, onDone, onBack, first = false }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = () => bridge.pickBackup().then((picked) => picked && setName(picked.name), (error) => setProblem(cleanError(error)))
  async function add(event) {
    event.preventDefault()
    setBusy(true)
    setProblem('')
    try {
      onDone(await bridge.importBackup(password))
    } catch (error) {
      setProblem(cleanError(error))
      setBusy(false)
    } finally {
      setPassword('')
    }
  }
  return (
    <form className={first ? 'pw-card' : 'pw-form'} onSubmit={add}>
      <h3>{first ? 'Use a backup' : 'Add from a backup'}</h3>
      <p>{first ? 'Choose a backup file. Its master password becomes your master password.' : 'Choose a backup file, then type the master password it was made with.'}</p>
      <button type="button" className={name ? 'outline-button' : 'primary-button'} onClick={pick}>{name ? `Chosen: ${name}` : 'Choose a backup file…'}</button>
      {name && (
        <>
          <label>Master password of the backup<input type="password" autoComplete="off" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button type="submit" className="primary-button" disabled={busy || !password}>{first ? 'Open' : 'Add'}</button>
        </>
      )}
      {problem && <p className="pw-said is-problem" role="alert"><Warning /> {problem}</p>}
      <button type="button" className="ghost-button" onClick={onBack}>Back</button>
    </form>
  )
}
