import { useEffect, useRef, useState } from 'react'
import { CaretLeft, Sparkle, Warning } from '@phosphor-icons/react'

import { cleanError } from '../assistant/useAi.js'
import { cleanQuery, dateLabel } from '../../shared/mail-model.mjs'
import { askMail } from './mail-ai.js'

/* Ask your mail (Phase 108): a question about, or a request to find, anything in the connected mail. Only the AI on
   this Mac reads it, only when Ask is pressed. The answer is plain text; the mail it was drawn from is listed under it,
   numbered as the AI numbered it, and opens in the room. */
export function MailAsk({ bridge, operators, hidden, onOpen, onBack }) {
  const [question, setQuestion] = useState('')
  const [state, setState] = useState(null) // { controller, found, sources, answer, text, done, error, asked }
  const input = useRef(null)
  useEffect(() => () => state?.controller?.abort(), [state?.controller])
  useEffect(() => { if (!hidden) input.current?.focus() }, [hidden])

  async function ask(event) {
    event.preventDefault()
    const words = question.trim()
    if (!words) return
    state?.controller?.abort()
    const controller = new AbortController()
    const mine = (change) => setState((now) => (now?.controller === controller ? change(now) : now))
    setState({ controller, asked: words, found: null, sources: [], text: '', done: false, error: '' })
    try {
      const result = await askMail(bridge, words, {
        operators,
        signal: controller.signal,
        onFound: (found) => mine((now) => ({ ...now, found })),
        onDelta: (piece) => mine((now) => ({ ...now, text: now.text + piece })),
      })
      if (!controller.signal.aborted) mine((now) => ({ ...now, found: result, sources: result.sources, text: result.answer || now.text, done: true }))
    } catch (error) {
      if (!controller.signal.aborted) mine((now) => ({ ...now, done: true, error: cleanError(error) }))
    }
  }

  const running = state && !state.done
  const found = state?.found
  return (
    <section className="mail-ask-all" aria-label="Ask your mail" hidden={hidden}>
      <button type="button" className="mail-back outline-button" onClick={onBack}><CaretLeft /> Inbox</button>
      <h2><Sparkle aria-hidden="true" /> Ask your mail</h2>
      <p className="mail-quiet">Ask a question, or say what to find: “What did Sam say about the deck?”, “invoices from last month”, “anything that needs a reply?”</p>
      <form onSubmit={ask}>
        <input ref={input} value={question} maxLength={300} placeholder="Ask anything about your email" aria-label="Your question for your mail" onChange={(event) => setQuestion(event.target.value)} />
        <button type="submit" className="primary-button" disabled={running || !question.trim()}>{running ? 'Looking…' : 'Ask'}</button>
      </form>
      <p className="mail-quiet">Only the AI on this Mac reads your mail, and only when you press Ask. It can’t send, move or delete anything.</p>
      {state?.error && <p className="mail-said is-problem" role="alert"><Warning /> {state.error}</p>}
      {found && (
        <p className="mail-quiet" role="status">
          {found.query ? <>Looked for <strong>{cleanQuery(found.query)}</strong>.</> : 'Looked at your newest mail.'}
          {state.done && !found.rows.length && ' Nothing matched. Try other words.'}
          {state.done && state.sources.length > 0 && found.rows.length > state.sources.length && ` Read ${state.sources.length} of ${found.rows.length >= 50 ? 'the newest 50' : found.rows.length} matches.`}
        </p>
      )}
      {state?.text && <p className="mail-answer" role="status">{state.text}</p>}
      {state?.done && state.sources.length > 0 && (
        <ol className="mail-sources" aria-label="The emails it read">
          {state.sources.map((row) => (
            <li key={row.id}>
              <button type="button" className="mail-link" onClick={() => onOpen(row.id)}>{row.subject}</button>
              <span> · {row.from.name} · {dateLabel(row.date)}{row.account ? ` · ${row.account}` : ''}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
