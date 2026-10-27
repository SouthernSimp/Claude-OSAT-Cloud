import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppleLogo, ArrowBendUpLeft, ArrowClockwise, ArrowSquareOut, At, CaretLeft, EnvelopeSimple, GoogleLogo, MagnifyingGlass, MicrosoftOutlookLogo, NotePencil, Sparkle, Warning } from '@phosphor-icons/react'

import { cleanError } from '../assistant/useAi.js'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { askLocalModel } from '../local-ai.js'
import { addSticky } from '../nodes-model.js'
import { purgeNotes } from '../notes-model.js'
import { NOT_ALLOWED, NOT_SET_UP, askMessages, cleanQuery, dateLabel, fullDate, stickyText } from '../../shared/mail-model.mjs'
import { PROVIDERS, providerFor } from '../../shared/imap-model.mjs'
import { Switch } from './settings/parts.jsx'
import '../styles/mail.css'

const ALLOWED_KEY = 'osat.mail.allowed.v1'
const wasAllowed = () => { try { return localStorage.getItem(ALLOWED_KEY) === '1' } catch { return false } }
const keepAllowed = (on) => { try { on ? localStorage.setItem(ALLOWED_KEY, '1') : localStorage.removeItem(ALLOWED_KEY) } catch { /* the button just shows again */ } }

/* Tools → Mail (Phase 59, desktop/mac-mail.cjs): your inbox, read through the Mail app on this Mac, (Phase 86,
   desktop/gmail.cjs) Gmail signed in directly when this build can, or (Phase 104, desktop/imap-mail.cjs) any provider
   over IMAP with an app password. A new person picks first ("Where's your mail?"); Change brings the choice back. Plain text only: a message is
   never drawn as a page, and nothing in it is loaded or opened. Reply starts a draft in Mail, or opens the message in
   Gmail; nothing is sent. Only in the Mac app. */
export function MailView({ commit, target }) {
  const bridge = window.osatMail
  if (!bridge) return <p className="pop-gone">Your inbox shows here in OSAT on your Mac.</p>
  return <MailRoom bridge={bridge} commit={commit} target={target} />
}

function MailRoom({ bridge, commit, target }) {
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
  // Gmail signed in directly (Phase 86): { ready, connected, email, busy }. Connected, it is what the room reads.
  const [gmail, setGmail] = useState(null)
  const google = gmail?.connected === true
  // Any provider over IMAP (Phase 104): { connected, provider, email, label }. `picking` is the "Where's your mail?"
  // screen: null, true (the choices) or a provider being signed in to.
  const [imap, setImap] = useState(null)
  const [picking, setPicking] = useState(null)
  const direct = google || imap?.connected === true
  // Settings → Mail and calendar → Change… opens the room on the choices.
  useEffect(() => { if (target?.pick) setPicking(true) }, [target?.pick, target?.at])

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
      setGmail(next?.gmail || null)
      setImap(next?.imap || null)
      setAvailable(next?.available === true || next?.gmail?.ready === true || Boolean(next?.imap))
      if (next?.gmail?.connected || next?.imap?.connected) { setAccess('allowed'); load() }
      else if (next?.available === true && wasAllowed()) { load(); lookAtAccounts() }
    }, () => setAvailable(false))
    return bridge.onGmail?.(setGmail)
  }, [bridge, load, lookAtAccounts])

  async function connectGmail() {
    setBusy(true)
    setProblem('')
    try {
      const next = await bridge.connectGmail()
      setGmail(next)
      if (next?.connected) {
        if (imap?.connected) setImap(await bridge.disconnectImap())
        setPicking(null); setAccess('allowed'); setSelected(null); await load()
      }
    } catch (error) {
      setProblem(cleanError(error))
    } finally {
      setBusy(false)
    }
  }
  // The mail server said yes: the room reads it from now on (Gmail signed in directly steps aside, one at a time).
  async function connectedImap(next) {
    setImap(next)
    if (google) setGmail(await bridge.disconnectGmail())
    setPicking(null)
    setAccess('allowed')
    setSelected(null)
    setRows(null)
    await load()
  }
  // The Mail app on this Mac: anything read directly steps aside, then the Mac is asked as before.
  async function readMailApp() {
    setPicking(null)
    if (google) setGmail(await bridge.disconnectGmail())
    if (imap?.connected) setImap(await bridge.disconnectImap())
    setRows(null)
    setSelected(null)
    await allow()
  }
  function pick(choice) {
    setProblem('')
    if (choice === 'mac') return readMailApp()
    if (choice === 'gmail' && gmail?.ready) return connectGmail()
    setPicking(choice)
  }

  async function disconnectGmail() {
    setProblem('')
    try {
      setGmail(await bridge.disconnectGmail())
      setRows(null)
      setSelected(null)
      setAccess(wasAllowed() ? 'allowed' : 'notAsked')
      if (wasAllowed()) load()
    } catch (error) {
      setProblem(cleanError(error))
    }
  }

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
  const where = google ? 'Gmail' : imap?.connected ? imap.label : 'Mail'
  const reply = act(() => bridge.reply(message.id), direct ? `Opened in ${where}: reply there.` : 'A reply is open in Mail. Nothing has been sent.')
  const openInMail = act(() => bridge.open(message.id), `Opened in ${where}.`)

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
  // "Where's your mail?": the first screen for a new person, and what Change brings back.
  if (picking === true || (!direct && access === 'notAsked' && picking === null)) {
    return <ProviderPicker gmailBusy={busy || gmail?.busy} macMail={available} problem={problem} onPick={pick} onBack={direct || access === 'allowed' ? () => setPicking(null) : null} />
  }
  if (picking === 'outlook') {
    return (
      <div className="mail-setup">
        <MicrosoftOutlookLogo aria-hidden="true" />
        <h2>Outlook signs in through your Mac</h2>
        <p>Microsoft only lets apps it has approved read Outlook directly, so OSAT reads it through the Mail app: add your Outlook account to the Mac once, then allow OSAT to read Mail.</p>
        <div className="mail-setup-actions">
          <button type="button" className="outline-button" onClick={addGmail}>1. Add Outlook to this Mac</button>
          <button type="button" className="primary-button" disabled={busy} onClick={readMailApp}>{busy ? 'Waiting for your Mac…' : '2. Allow OSAT to read Mail'}</button>
        </div>
        {adding && <p className="mail-said" role="status">System Settings is open on Internet Accounts. Choose Microsoft Exchange (or Outlook.com), sign in, and leave Mail turned on. Then come back here.</p>}
        <p className="mail-quiet"><button type="button" className="mail-link" onClick={() => setPicking(true)}>Pick another</button></p>
      </div>
    )
  }
  if (picking) {
    return <ImapForm key={picking} bridge={bridge} provider={picking} onDone={connectedImap} onBack={() => setPicking(true)} />
  }
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
            <p className="mail-quiet">Your Mac asks once. <button type="button" className="mail-link" onClick={() => setPicking(true)}>Pick another way</button></p>
          </>
        )}
        {access === 'denied' && (
          <>
            <h2>Mail needs your OK</h2>
            <p>{NOT_ALLOWED}</p>
            <button type="button" className="primary-button" disabled={busy} onClick={allow}>Try again</button>
            <p className="mail-quiet"><button type="button" className="mail-link" onClick={() => setPicking(true)}>Read it straight from Gmail, iCloud or another provider instead</button></p>
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
        {google && (
          <p className="mail-quiet mail-accounts">
            Reading Gmail{gmail.email ? ` (${gmail.email})` : ''} · <button type="button" className="mail-link" onClick={() => setPicking(true)}>Change</button> · <button type="button" className="mail-link" onClick={disconnectGmail}>Disconnect</button>
          </p>
        )}
        {!google && imap?.connected && (
          <p className="mail-quiet mail-accounts">
            Reading {imap.label} ({imap.email}) · <button type="button" className="mail-link" onClick={() => setPicking(true)}>Change</button>
          </p>
        )}
        {accounts && !direct && (
          <p className="mail-quiet mail-accounts">
            {accounts.length ? <>Reading {accounts.map((account) => account.gmail ? `Gmail${account.address ? ` (${account.address})` : ''}` : account.name).join(', ')} in the Mail app</> : 'No account is turned on in Mail.'}
            {' · '}<button type="button" className="mail-link" onClick={() => setPicking(true)}>Faster: read it straight from your provider</button>
          </p>
        )}
        {adding && <p className="mail-said" role="status">{ADDING}</p>}
        {bridge.follow && <FollowCard bridge={bridge} />}
        {searched && (
          <p className="mail-quiet mail-searched">
            Results for “{searched.words}”
            {!searched.inside && !google && <> · <button type="button" className="mail-link" onClick={() => load(searched.words, true)}>Look inside messages too</button></>}
            {' · '}<button type="button" className="mail-link" onClick={clearSearch}>Clear</button>
          </p>
        )}
        {rows === null && !problem && <p className="mail-quiet">{loading ? (direct ? `Looking in ${where}…` : 'Looking in Mail… the first time can take a moment.') : ''}</p>}
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
              <button type="button" className="outline-button" onClick={openInMail}><ArrowSquareOut /> Open in {where}</button>
              <button type="button" className="outline-button" aria-expanded={Boolean(asking)} onClick={() => (asking ? setAsking(null) : setAsking({ controller: null, question: '', text: '', done: true, error: '' }))}><Sparkle /> Ask about this message</button>
            </div>
            {said && <p className="mail-said" role="status">{said}</p>}
            {asking && <AskBox key={message.id} asking={asking} onAsk={ask} onClose={() => setAsking(null)} />}
            <pre className="mail-body" tabIndex={0} role="region" aria-label="Message text">{message.body || '(This message has no text.)'}</pre>
            {message.truncated && <p className="mail-quiet">This is the start of a long message. Open in {where} to read all of it.</p>}
            <p className="mail-quiet">Shown as plain text. Pictures and links in a message aren’t loaded or opened here.</p>
          </article>
        )}
      </main>
      {toast}
    </div>
  )
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const ago = (at) => { const minutes = Math.round((Date.now() - at) / 60000); return minutes < 1 ? 'just now' : minutes < 60 ? `${plural(minutes, 'minute')} ago` : `at ${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` }

/* To-dos from email (Phase 84, desktop/mail-follow.cjs): once an hour, what new mail asks of you comes into Just in as
   to-dos. One switch, what the last look brought, Look now, and Take them back for that batch. */
function FollowCard({ bridge }) {
  const [state, setState] = useState(null)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    bridge.follow().then(setState, () => {})
    return bridge.onFollow(setState)
  }, [bridge])
  if (!state) return null
  const act = (work) => { setProblem(''); work().then(setState, (error) => setProblem(cleanError(error))) }
  const line = !state.on
    ? 'Off. Turn it on and what new mail asks of you comes into Just in as to-dos. Only the AI on this Mac reads it.'
    : state.busy ? 'Reading your new mail…'
      : problem || state.problem || (state.last?.count
        ? `${plural(state.last.count, 'to-do')} from ${plural(state.last.emails, 'email')}, ${ago(state.last.at)}. Each hour, new mail is read for what it asks of you.`
        : 'Each hour, the AI on this Mac reads new mail for what it asks of you. Newsletters and robots are skipped.')
  return (
    <section className="mail-follow" aria-label="To-dos from email">
      <div>
        <strong>To-dos from email</strong>
        <small>{line}</small>
      </div>
      <Switch label="To-dos from email" checked={state.on} onChange={(on) => act(() => bridge.setFollow(on))} />
      {state.on && <span className="mail-follow-actions">
        <button type="button" className="mail-link" disabled={state.busy} onClick={() => act(bridge.followNow)}>Look now</button>
        {state.last?.undo && <> · <button type="button" className="mail-link" disabled={state.busy} onClick={() => act(bridge.undoFollow)}>Take them back</button></>}
      </span>}
    </section>
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

const CHOICES = [
  { id: 'gmail', label: 'Gmail', Icon: GoogleLogo },
  { id: 'icloud', label: 'iCloud', Icon: AppleLogo },
  { id: 'outlook', label: 'Outlook', Icon: MicrosoftOutlookLogo },
  { id: 'yahoo', label: 'Yahoo', Icon: At },
  { id: 'other', label: 'Other', Icon: EnvelopeSimple },
]

/* Where's your mail? (Phase 104) The provider first, like Mail and Spark ask; the Mail app on this Mac stays a choice. */
function ProviderPicker({ gmailBusy, macMail, problem, onPick, onBack }) {
  return (
    <div className="mail-setup">
      <EnvelopeSimple aria-hidden="true" />
      <h2>Where’s your mail?</h2>
      <p>OSAT shows your inbox, finds any email and turns what it asks of you into to-dos. Read only: it never sends, deletes or marks anything.</p>
      <div className="mail-providers" role="group" aria-label="Where your mail is">
        {CHOICES.map(({ id, label, Icon }) => (
          <button key={id} type="button" className="mail-provider" disabled={id === 'gmail' && gmailBusy} onClick={() => onPick(id)}>
            <Icon weight="bold" aria-hidden="true" /><span>{id === 'gmail' && gmailBusy ? 'Finish in your browser…' : label}</span>
          </button>
        ))}
      </div>
      {macMail && <p className="mail-quiet">Or <button type="button" className="mail-link" onClick={() => onPick('mac')}>use the Mail app on this Mac</button>, with the accounts it already has.</p>}
      {problem && <p className="mail-said is-problem" role="alert"><Warning /> {problem}</p>}
      {onBack && <p className="mail-quiet"><button type="button" className="mail-link" onClick={onBack}>Back to your inbox</button></p>}
    </div>
  )
}

/* Signing in with an app password: the provider's own page makes one, and OSAT checks it with the server before
   keeping it in the Keychain. */
function ImapForm({ bridge, provider, onDone, onBack }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const kind = PROVIDERS[provider] || PROVIDERS.other
  const openHelp = () => window.osatSearch?.openLink?.(kind.help).catch(() => {})
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setProblem('')
    try {
      // An address typed under Other that belongs to a known provider signs in there.
      const which = provider === 'other' && providerFor(email) !== 'other' ? providerFor(email) : provider
      onDone(await bridge.connectImap({ provider: which, email, password, host }))
    } catch (error) {
      setProblem(cleanError(error))
      setBusy(false)
    }
  }
  return (
    <form className="mail-setup mail-sign-in" onSubmit={submit}>
      <EnvelopeSimple aria-hidden="true" />
      <h2>{provider === 'other' ? 'Your mail' : kind.label}</h2>
      <p>{provider === 'other'
        ? 'Any mail that offers IMAP works. Use the address and password your provider gives mail apps.'
        : `${kind.label} asks apps like OSAT for an app password, not your usual one. It takes a minute to make, and you can take it back any time.`}</p>
      {kind.help && <button type="button" className="mail-link" onClick={openHelp}>{kind.helpLabel} ↗</button>}
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>App password<input type="password" autoComplete="off" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {provider === 'other' && <label>Mail server<input placeholder="imap.example.com" required value={host} onChange={(event) => setHost(event.target.value)} /></label>}
      {problem && <p className="mail-said is-problem" role="alert"><Warning /> {problem}</p>}
      <div className="mail-setup-actions">
        <button type="button" className="outline-button" onClick={onBack}>Back</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Checking…' : 'Connect'}</button>
      </div>
      <p className="mail-quiet">The password stays in this Mac’s Keychain. OSAT only reads your inbox.</p>
    </form>
  )
}
