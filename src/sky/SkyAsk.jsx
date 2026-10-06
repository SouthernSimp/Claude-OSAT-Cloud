import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChatCircle, Sparkle, Stop, X } from '@phosphor-icons/react'

import { answeringLabel } from '../assistant/ask-model.js'
import { noteKind, noteWhere } from '../assistant/ask-sources.js'
import { useAskHere } from '../assistant/useAskHere.js'
import { Markdown } from '../lib/markdown.jsx'
import { isActiveNote } from '../notes-model.js'
import { asksToSort } from './sort-unsorted.js'

/* The AI, in the Sky: a pill at the bottom that opens a small card. Ask about your Sky ("which nodes
   belong together?"). Saying "sort these" (or pressing Sort Unsorted) opens Unsorted's sorter on
   "Suggest homes for all", the one place sorting happens. The answer says where it comes from and is kept
   as a chat ("Keep talking" opens it in Ask). With no AI, the card says why and how to set it up.
   Esc puts the card away. */
export function SkyAsk({ workspace, commit, models, ai, open, focus, asking, setAsking, navigate, onSortAll }) {
  const label = answeringLabel(models)
  const [scope, setScope] = useState('focus')
  const focused = workspace.folders.find((folder) => folder.id === focus)
  const effectiveScope = scope === 'focus' && !focused ? 'workspace' : scope
  const { answer, ask, stop, close } = useAskHere({ workspace, commit, modelId: models?.[0]?.id, context: { open: [...open], focus, scope: effectiveScope, where: 'sky' } })
  const [draft, setDraft] = useState('')
  const [unanswered, setUnanswered] = useState('')
  const field = useRef(null)
  useEffect(() => { if (asking) field.current?.focus() }, [asking])

  const source = (id) => workspace.notes.find((note) => note.id === id)

  function submit(event) {
    event.preventDefault()
    const question = draft.trim()
    if (!question) return
    if (asksToSort(question)) { setDraft(''); onSortAll(); return }
    // With no AI the question stays in the field, and the card says why.
    if (!label) { setUnanswered(question); return }
    setDraft('')
    setUnanswered('')
    ask(question)
  }

  if (!asking) {
    return <button type="button" className="sky-ask-pill" onClick={() => setAsking(true)}><Sparkle weight="fill" /> Ask</button>
  }
  return (
    <section className="sky-ask" role="dialog" aria-label="Ask about your Sky">
      <header>
        <Sparkle weight="fill" />
        <strong>Ask about your Sky</strong>
        <button type="button" aria-label="Put it away" onClick={() => setAsking(false)}><X /></button>
      </header>
      <label className="sky-ask-scope">Use<select aria-label="AI note scope" value={effectiveScope} disabled={answer?.busy} onChange={(event) => setScope(event.target.value)}>{focused && <option value="focus">This topic · {focused.name}</option>}<option value="workspace">Workspace · related notes</option><option value="none">No notes</option></select></label>

      {!answer && !unanswered && (
        <p className="sky-ask-lead">Ask which nodes belong together, what is in a node, or say “sort these”.</p>
      )}

      <div className="sky-ask-body" aria-live="polite">
        {unanswered && !label && <p className="sky-ask-error" role="alert">{ai.line} Your question is still in the box.</p>}
        {answer && (
          <>
            <p className="sky-ask-question">{answer.question}</p>
            {answer.text ? <Markdown text={answer.text} headingOffset={2} /> : answer.busy && <p className="sky-ask-wait">{['asleep', 'waking'].includes(ai.key) ? 'Waking the AI…' : 'Thinking…'}</p>}
            {answer.error && <p className="sky-ask-error" role="alert">{answer.error}</p>}
            {answer.noteIds?.length > 0 && <div className="sky-ask-sources"><small>Notes shared · excerpts may be shortened</small>{answer.noteIds.map((id) => {
              const note = source(id)
              if (!isActiveNote(note)) return <span className="sky-ask-gone" key={id}>No longer saved</span>
              return <button type="button" key={id} title={[noteKind(note), noteWhere(note, workspace.folders)].filter(Boolean).join(' · ')} onClick={() => navigate('Notes', { noteId: id })}><em>{noteKind(note)}</em> {note.title || 'Untitled'}</button>
            })}{answer.omitted > 0 && <small>{answer.omitted} more notes were not included. This is a partial view.</small>}</div>}
          </>
        )}
      </div>

      <form className="sky-ask-form" onSubmit={submit}>
        <input
          ref={field}
          value={draft}
          placeholder={label ? 'Ask, or say “sort these”' : 'Say “sort these”'}
          aria-label="Ask about your Sky"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setAsking(false) } }}
        />
        {answer?.busy
          ? <button type="button" aria-label="Stop" onClick={stop}><Stop weight="fill" /></button>
          : <button type="submit" aria-label="Ask" disabled={!draft.trim()}><ArrowUp weight="bold" /></button>}
      </form>

      <footer>
        <button type="button" className="sky-ask-sort" onClick={onSortAll}><Sparkle weight="bold" /> Sort Unsorted</button>
        {answer && !answer.busy && (
          <button type="button" onClick={() => { const chatId = answer.chatId; close(); setAsking(false); navigate('Assistant', { chatId }) }}><ChatCircle /> Keep talking</button>
        )}
        <small>
          {label
            ? `Answers come from ${label}.`
            : <>{ai.line} <button type="button" onClick={() => { setAsking(false); navigate('Settings', { section: 'ai' }) }}>Set up the AI</button></>}
        </small>
      </footer>
    </section>
  )
}
