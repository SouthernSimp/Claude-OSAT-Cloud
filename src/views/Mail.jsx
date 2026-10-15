import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowBendUpLeft, ArrowClockwise, ArrowSquareOut, CaretLeft, EnvelopeSimple, GoogleLogo, MagnifyingGlass, NotePencil, Sparkle, Warning } from '@phosphor-icons/react'

import { cleanError } from '../assistant/useAi.js'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { askLocalModel } from '../local-ai.js'
import { addSticky } from '../nodes-model.js'
import { purgeNotes } from '../notes-model.js'
import { NOT_ALLOWED, NOT_SET_UP, askMessages, cleanQuery, dateLabel, fullDate, stickyText } from '../../shared/mail-model.mjs'
import '../styles/mail.css'

const ALLOWED_KEY = 'osat.mail.allowed.v1'
const wasAllowed = () => { try { return localStorage.getItem(ALLOWED_KEY) === '1' } catch { return false } }
const keepAllowed = (on) => { try { on ? localStorage.setItem(ALLOWED_KEY, '1') : localStorage.removeItem(ALLOWED_KEY) } catch { /* the button just shows again */ } }

/* Tools → Mail (Phase 59, desktop/mac-mail.cjs): your inbox, read through the Mail app on this Mac. Plain text
   only: a message is never drawn as a page, and nothing in it is loaded or opened. Reply starts a draft in
   Mail itself and sends nothing. Only in the Mac app. */
export function MailView({ commit }) {
  const bridge = window.osatMail
  if (!bridge) return <p className="pop-gone">Your inbox shows here in OSAT on your Mac.</p>
  return <MailRoom bridge={bridge} commit={commit} />
}

function MailRoom({ bridge, commit }) {
  const [available, setAvailable] = useState(null)
  // 'notAsked' until the button is pressed once on this Mac; then 'allowed', or why not.
  const [access, setAccess] = useState(() => (wasAllowed() ? 'allowed' : 'notAsked'))
  const [rows, setRows] = useState(null)
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(null)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [said, setSaid] = useState('')
  const [asking, setAsking] = useState(null)
  // The accounts Mail reads ([{ name, address, gmail }]), and whether Nate went off to add Gmail.
  const [accounts, setAccounts] = useState(null)
  const [adding, setAdding] = useState(false)
  const [toast, showUndo] = useUndoToast()
  const latest = useRef(0)

  // Why Mail can't be read becomes a state of the room, not an error to dismiss.
  const explain = useCallback((error) => {
    const line = cleanError(error)
    if (line === NOT_ALLOWED) { keepAllowed(false); setAccess('denied') }
    else if (line === NOT_SET_UP) setAccess('noAccounts')
    else setProblem(line)
  }, [])

  const load = useCallback(async (words = '', inside = false) => {
    const turn = ++latest.current
    setLoading(true)
    setProblem('')
    try {
      const next = words ? await bridge.search(words, inside) : await bridge.list()
      if (turn !== latest.current) return
      setRows(next)
      setSearched(words ? { words, inside } : null)
      setAccess('allowed')
    } catch (error) {
      if (turn === latest.current) explain(error)
    } finally {
      if (turn === latest.current) setLoading(false)
    }
  }, [bridge, explain])

  const lookAtAccounts = useCallback(() => bridge.accounts?.().then(setAccounts, () => {}), [bridge])

  useEffect(() => {
    bridge.status().then((next) => {
      setAvailable(next?.available === true)
      if (next?.available === true && wasAllowed()) { load(); lookAtAccounts() }
    }, () => setAvailable(false))
  }, [bridge, load, lookAtAccounts])

  /* Gmail is a Google account added to the Mac: System Settings signs in to Google itself, so OSAT never sees a
     password or a token, and the same sign-in brings Google Calendar to the Mac's Calendar. Coming back to OSAT
     looks again. */
  async function addGmail() {
    setProblem('')
    try {
      await bridge.addAccount()
      setAdding(true)
    } catch (error) {
      setProblem(cleanError(error))
    }
  }
  useEffect(() => {
    if (!adding) return undefined
    const again = () => {
      if (access === 'allowed') { load(); lookAtAccounts() } else allow()
    }
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [adding, access]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (accounts?.some((account) => account.gmail)) setAdding(false) }, [accounts])

  async function allow() {
    setBusy(true)
    setProblem('')
    try {
      await bridge.allow()
      keepAllowed(true)
      setAccess('allowed')
      lookAtAccounts()
      await load()
    } catch (error) {
      explain(error)
    } finally {
      setBusy(false)
    }
  }

  // Opening a message reads it; it does not mark it read in Mail.
  useEffect(() => {
    setMessage(null)
    setAsking(null)
    setSaid('')
    if (selected === null) return undefined
    let live = true
    bridge.read(selected).then(
      (next) => { if (live) setMessage(next) },
      (error) => { if (live) { setProblem(cleanError(error)); setSelected(null) } },
    )
    return () => { live = false }
  }, [bridge, selected])

  useEffect(() => () => asking?.controller?.abort(), [asking?.controller])

  function search(event) {
    event.preventDefault()
    const words = cleanQuery(query)
    setSelected(null)
    load(words)
  }
  function clearSearch() {
    setQuery('')
    setSelected(null)
    load()
  }

  const act = (work, done) => async () => {
    setProblem('')
    try { await work(); setSaid(done) } catch (error) { setProblem(cleanError(error)) }
  }
  const reply = act(() => bridge.reply(message.id), 'A reply is open in Mail. Nothing has been sent.')
  const openInMail = act(() => bridge.open(message.id), 'Opened in Mail.')

  function makeSticky() {
    const text = stickyText(message)
    if (!text) return
    let made = null
    commit((state) => { const result = addSticky(state, text, null, { source: 'Mail' }); made = result.note; return result.state })
    if (made) showUndo('Made a sticky in Just in', () => commit((state) => purgeNotes(state, [made.id])))
  }

  /* Asking is only ever pressed, never automatic, and only the AI on this Mac answers (askLocalModel). */
  async function ask(question) {
    asking?.controller?.abort()
    const messages = askMessages(message, question)
    if (!messages) return
    const controller = new AbortController()
    const mine = (change) => setAsking((now) => (now?.controller === controller ? change(now) : now))
    setAsking({ controller, question, text: '', done: false, error: '' })
    try {
      const full = await askLocalModel(messages, {
        signal: controller.signal,
        onDelta: (piece) => mine((now) => ({ ...now, text: now.text + piece })),
        unavailableMessage: 'Set up the AI in Settings → AI to ask about a message.',
      })
      if (!controller.signal.aborted) mine((now) => ({ ...now, text: String(full || now.text).trim(), done: true }))
    } catch (error) {
      if (!controller.signal.aborted) mine((now) => ({ ...now, done: true, error: cleanError(error) }))
    }
  }

  // Esc backs out one step: the question, then the message. (The desk then closes the room.)
  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (event.target.closest?.('input, textarea') && !event.target.closest('.mail-ask')) {
      if (!query) return
      event.preventDefault()
      clearSearch()
      return
    }
    if (asking || selected !== null) {
      event.preventDefault()
      if (asking) setAsking(null)
      else setSelected(null)
    }
  }

  // Only the message that is picked now: never the last one while the next is still being read.
  const open = selected !== null && message?.id === selected ? message : null
  const shown = useMemo(() => (rows || []).filter((row) => filter === 'all' || row.unread), [rows, filter])

  if (available === null) return <p className="pop-gone">Looking for Mail…</p>
  if (!available) {
    return (
      <div className="mail-setup">
        <EnvelopeSimple aria-hidden="true" />
        <h2>Mail isn’t on this Mac</h2>
        <p>OSAT reads your inbox through the Mail app, which comes with a Mac.</p>
      </div>
    )
  }
  if (access !== 'allowed') {
    return (
      <div className="mail-setup">
        <EnvelopeSimple aria-hidden="true" />
        {access === 'notAsked' && (
          <>
            <h2>Read your email here</h2>
            <p>OSAT reads your inbox through the Mail app on this Mac, where your accounts are already signed in. It never sends anything and never keeps a password.</p>
            <button type="button" className="primary-button" disabled={busy} onClick={allow}>{busy ? 'Waiting for your Mac…' : 'Allow OSAT to read Mail'}</button>
            <p className="mail-quiet">Your Mac asks once.</p>
            <GmailHint adding={adding} onAdd={addGmail} />
          </>
        )}
        {access === 'denied' && (
          <>
            <h2>Mail needs your OK</h2>
            <p>{NOT_ALLOWED}</p>
            <button type="button" className="primary-button" disabled={busy} onClick={allow}>Try again</button>
          </>
        )}
        {access === 'noAccounts' && (
          <>
            <h2>Add your email</h2>
            <p>{NOT_SET_UP}</p>
            <div className="mail-setup-actions">
              <button type="button" className="primary-button" onClick={addGmail}><GoogleLogo weight="bold" /> Add Gmail to this Mac</button>
              <button type="button" className="outline-button" disabled={busy} onClick={allow}>Look again</button>
            </div>
            {adding && <p className="mail-said" role="status">{ADDING}</p>}
          </>
        )}
        {problem && <p className="mail-said is-problem" role="alert"><Warning /> {problem}</p>}
      </div>
    )
  }

  return (
    <div className="mail-room" data-open={selected !== null ? 'message' : 'list'} onKeyDown={onKeyDown}>
      {problem && <p className="mail-said is-problem" role="alert"><Warning /> {problem}</p>}
      <aside className="mail-list" aria-label="Your inbox">
        <form className="mail-find" role="search" onSubmit={search}>
          <label>
            <MagnifyingGlass aria-hidden="true" />
            <input value={query} placeholder="Search your mail" aria-label="Search your mail" maxLength={200} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button type="button" className="outline-button" disabled={loading} onClick={() => (searched ? load(searched.words, searched.inside) : load())} aria-label="Look again"><ArrowClockwise className={loading ? 'is-spinning' : ''} /></button>
        </form>
        <div className="mail-filter" role="group" aria-label="Show">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button type="button" aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>Unread</button>
        </div>
        {accounts && (
          <p className="mail-quiet mail-accounts">
            {accounts.length ? <>Reading {accounts.map((account) => account.gmail ? `Gmail${account.address ? ` (${account.address})` : ''}` : account.name).join(', ')}</> : 'No account is turned on in Mail.'}
            {!accounts.some((account) => account.gmail) && <> · <button type="button" className="mail-link" onClick={addGmail}>Add Gmail</button></>}
          </p>
        )}
        {adding && <p className="mail-said" role="status">{ADDING}</p>}
        {searched && (
          <p className="mail-quiet mail-searched">
            Results for “{searched.words}”
            {!searched.inside && <> · <button type="button" className="mail-link" onClick={() => load(searched.words, true)}>Look inside messages too</button></>}
            {' · '}<button type="button" className="mail-link" onClick={clearSearch}>Clear</button>
          </p>
        )}
        {rows === null && !problem && <p className="mail-quiet">{loading ? 'Looking in Mail… the first time can take a moment.' : ''}</p>}
        <ul>
          {shown.map((row) => (
            <li key={row.id}>
              <button type="button" className={row.unread ? 'is-unread' : ''} aria-current={row.id === selected ? 'true' : undefined} aria-label={`${row.unread ? 'Unread. ' : ''}${row.subject}, from ${row.from.name}`} onClick={() => { setProblem(''); setSelected(row.id) }}>
                <span className="mail-from"><i aria-hidden="true" />{row.from.name}<time dateTime={row.date}>{dateLabel(row.date)}</time></span>
                <span className="mail-subject">{row.subject}</span>
                {row.snippet && <span className="mail-snippet">{row.snippet}</span>}
              </button>
            </li>
          ))}
        </ul>
        {rows && !shown.length && <p className="mail-quiet">{searched ? 'Nothing found. Try fewer words.' : filter === 'unread' ? 'Nothing unread.' : 'Nothing in your inbox.'}</p>}
        {rows && rows.length >= 50 && <p className="mail-quiet">Showing the newest 50. Search to find older ones.</p>}
      </aside>

      <main className="mail-main">
        {selected === null && <p className="mail-empty">{rows?.length ? 'Pick a message to read it.' : ''}</p>}
        {selected !== null && !open && !problem && <p className="mail-quiet">Opening…</p>}
        {open && (
          <article className="mail-message">
            <button type="button" className="mail-back outline-button" onClick={() => setSelected(null)}><CaretLeft /> Inbox</button>
            <header>
              <h2>{message.subject}</h2>
              <p>{message.from.name}{message.from.address && message.from.address !== message.from.name ? <span> &lt;{message.from.address}&gt;</span> : null}</p>
              <small>{fullDate(message.date)}</small>
            </header>
            <div className="mail-actions">
              <button type="button" className="primary-button" onClick={reply}><ArrowBendUpLeft /> Reply</button>
              <button type="button" className="outline-button" onClick={makeSticky}><NotePencil /> Make a sticky</button>
              <button type="button" className="outline-button" onClick={openInMail}><ArrowSquareOut /> Open in Mail</button>
              <button type="button" className="outline-button" aria-expanded={Boolean(asking)} onClick={() => (asking ? setAsking(null) : setAsking({ controller: null, question: '', text: '', done: true, error: '' }))}><Sparkle /> Ask about this message</button>
            </div>
            {said && <p className="mail-said" role="status">{said}</p>}
            {asking && <AskBox key={message.id} asking={asking} onAsk={ask} onClose={() => setAsking(null)} />}
            <pre className="mail-body" tabIndex={0} role="region" aria-label="Message text">{message.body || '(This message has no text.)'}</pre>
            {message.truncated && <p className="mail-quiet">This is the start of a long message. Open in Mail to read all of it.</p>}
            <p className="mail-quiet">Shown as plain text. Pictures and links in a message aren’t loaded or opened here.</p>
          </article>
        )}
      </main>
      {toast}
    </div>
  )
}

/* The question for the AI on this Mac. Nothing is sent until Ask is pressed, and nothing leaves the Mac. */
function AskBox({ asking, onAsk, onClose }) {
  const [question, setQuestion] = useState('')
  const running = asking.controller && !asking.done
  return (
    <section className="mail-ask" aria-label="Ask about this message">
      <form onSubmit={(event) => { event.preventDefault(); onAsk(question) }}>
        <input autoFocus value={question} maxLength={300} placeholder="What is this about, and does it need a reply?" aria-label="Your question about this message" onChange={(event) => setQuestion(event.target.value)} />
        <button type="submit" className="outline-button" disabled={running}>{running ? 'Thinking…' : 'Ask'}</button>
        <button type="button" className="outline-button" onClick={onClose}>Not now</button>
      </form>
      <p className="mail-quiet">Only the AI on this Mac reads the message, and only when you press Ask.</p>
      {asking.error && <p className="mail-said is-problem" role="alert"><Warning /> {asking.error}</p>}
      {asking.text && <p className="mail-answer" role="status">{asking.text}</p>}
    </section>
  )
}

const ADDING = 'System Settings is open on Internet Accounts. Choose Add Account → Google, sign in, and leave Mail turned on (Calendars too, for your Google Calendar). Then come back here: OSAT looks again.'

/* Before Mail is allowed: Gmail is one sign-in on the Mac away. */
function GmailHint({ adding, onAdd }) {
  return adding
    ? <p className="mail-said" role="status">{ADDING}</p>
    : <p className="mail-quiet">Use Gmail? <button type="button" className="mail-link" onClick={onAdd}>Add Gmail to this Mac</button>. One sign-in brings your Google Calendar too.</p>
}
