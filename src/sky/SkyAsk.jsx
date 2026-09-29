import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ArrowUp, ChatCircle, Sparkle, Stop, X } from '@phosphor-icons/react'

import { answeringLabel, askModel } from '../assistant/ask-model.js'
import { cleanError } from '../assistant/useAi.js'
import { useAskHere } from '../assistant/useAskHere.js'
import { Markdown } from '../lib/markdown.jsx'
import { folderPath } from '../notes-model.js'
import { pileOf } from '../nodes-model.js'
import {
  applyGroup, asksToSort, modelSuggestions, MOST, sortRequests, stillToSort, undoGroups, unsortedStickies, wordSuggestions,
} from './sort-unsorted.js'

const sayStickies = (count) => `${count} ${count === 1 ? 'sticky' : 'stickies'}`

/* The AI, in the Sky: a pill at the bottom that opens a small card. Ask about your Sky ("which nodes
   belong together?"), or say "sort these" (or press Sort Unsorted) and it suggests a home for every
   sticky in Unsorted, one line per place, each with Move and Dismiss. Nothing moves until you click,
   and one Undo takes a move back. With no AI it works from matching words. The answer says where it
   comes from and is kept as a chat ("Keep talking" opens it in Ask). Esc puts the card away. */
export function SkyAsk({ workspace, commit, models, open, asking, setAsking, navigate, showUndo }) {
  const latest = useRef(workspace)
  latest.current = workspace
  const label = answeringLabel(models)
  const { answer, ask, stop, close } = useAskHere({ workspace, commit, modelId: models?.[0]?.id, context: { open: [...open], where: 'sky' } })
  const [draft, setDraft] = useState('')
  const [sort, setSort] = useState(null) // { busy, line, groups, more } while sorting or showing what it found
  const job = useRef(null)
  const field = useRef(null)
  useEffect(() => { if (asking) field.current?.focus() }, [asking])
  useEffect(() => () => job.current?.controller.abort(), [])

  const shown = useMemo(() => (sort ? stillToSort(sort.groups, workspace) : []), [sort, workspace])
  const title = (id) => workspace.notes.find((note) => note.id === id)?.title || 'a sticky'

  function put(patch) { setSort((value) => (value ? { ...value, ...patch } : value)) }

  async function sortNow() {
    job.current?.controller.abort()
    close()
    const state = latest.current
    const stickies = unsortedStickies(state)
    const more = pileOf(state.notes, null).length > stickies.length
    if (!stickies.length) { setSort({ busy: false, line: 'Unsorted is empty. Nothing to sort.', groups: [], more: false }); return }
    if (!label) {
      const groups = wordSuggestions(state, stickies)
      setSort({ busy: false, line: groups.length ? '' : 'Nothing in Unsorted looks like it goes together yet.', groups, more })
      return
    }
    const mine = { controller: new AbortController() }
    job.current = mine
    setSort({ busy: true, line: `Asking ${label}…`, groups: [], more })
    try {
      const { places, batches } = sortRequests(state, stickies)
      const answers = []
      for (const batch of batches) {
        answers.push({ from: batch.from, text: await askModel(batch.messages, { signal: mine.controller.signal }) })
      }
      if (job.current !== mine) return
      const groups = modelSuggestions(state, stickies, places, answers)
      setSort({ busy: false, line: groups.length ? '' : 'Nothing in Unsorted looks like it goes together yet.', groups, more })
    } catch (error) {
      if (job.current !== mine || error?.name === 'AbortError') return
      // The model couldn't be asked: matching words still can.
      const groups = wordSuggestions(state, stickies)
      setSort({ busy: false, line: `${cleanError(error)} ${groups.length ? 'Matching words suggest this instead.' : ''}`.trim(), groups, more })
    }
  }

  function stopSorting() {
    job.current?.controller.abort()
    job.current = null
    setSort(null)
  }

  function submit(event) {
    event.preventDefault()
    const question = draft.trim()
    if (!question) return
    setDraft('')
    if (asksToSort(question)) { sortNow(); return }
    stopSorting()
    if (label) ask(question)
  }

  /* Move (or make) these groups: one commit, one Undo. */
  function accept(groups) {
    const before = latest.current
    const made = []
    commit((state) => groups.reduce((next, group) => {
      const result = applyGroup(next, group)
      if (result.made) made.push(result.made)
      return result.state
    }, state))
    const ids = groups.flatMap((group) => group.noteIds)
    const [only] = groups
    const text = groups.length > 1 ? `Sorted ${sayStickies(ids.length)}`
      : only.kind === 'make' ? `Made the node “${only.name}” with ${sayStickies(ids.length)}`
        : `Moved ${sayStickies(ids.length)} to ${folderPath(before.folders, only.folderId).join(' › ')}`
    showUndo(text, () => commit(undoGroups(before, ids, made)))
  }
  const dismiss = (group) => put({ groups: sort.groups.filter((item) => item.key !== group.key) })

  const line = sort && !sort.busy && shown.length === 0 ? (sort.line || 'Nothing left to sort here.') : sort?.line

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

      {!answer && !sort && (
        <p className="sky-ask-lead">Ask which nodes belong together, what is in a node, or say “sort these”.</p>
      )}

      <div className="sky-ask-body" aria-live="polite">
        {answer && (
          <>
            <p className="sky-ask-question">{answer.question}</p>
            {answer.text ? <Markdown text={answer.text} headingOffset={2} /> : answer.busy && <p className="sky-ask-wait">Thinking…</p>}
            {answer.error && <p className="sky-ask-error" role="alert">{answer.error}</p>}
          </>
        )}
        {sort && (
          <div className="sort-help" role="status">
            {line && <p>{line}</p>}
            {shown.map((group) => (
              <div key={group.key} className="sort-suggestion">
                <p>
                  {group.kind === 'make'
                    ? <>{sayStickies(group.noteIds.length)} could be a new node, <strong>{group.name}</strong>:</>
                    : <>{group.noteIds.length === 1 ? 'This sticky looks like it belongs' : `These ${group.noteIds.length} stickies look like they belong`} in <strong>{folderPath(workspace.folders, group.folderId).join(' › ')}</strong>:</>}
                  {' '}{group.noteIds.slice(0, 3).map((id) => `“${title(id).slice(0, 40)}”`).join(', ')}{group.noteIds.length > 3 ? ` and ${group.noteIds.length - 3} more` : ''}.
                </p>
                <button type="button" className="is-primary" onClick={() => accept([group])}><ArrowRight weight="bold" /> {group.kind === 'make' ? 'Make it' : 'Move'}</button>
                <button type="button" onClick={() => dismiss(group)}>Dismiss</button>
              </div>
            ))}
            {shown.length > 1 && <button type="button" className="is-primary sort-all" onClick={() => accept(shown)}>Move them all</button>}
            {sort.more && !sort.busy && shown.length > 0 && <p className="sort-more">That was the first {MOST}. Sort again for the rest.</p>}
          </div>
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
        {answer?.busy || sort?.busy
          ? <button type="button" aria-label="Stop" onClick={() => { stop(); stopSorting() }}><Stop weight="fill" /></button>
          : <button type="submit" aria-label="Ask" disabled={!draft.trim()}><ArrowUp weight="bold" /></button>}
      </form>

      <footer>
        <button type="button" className="sky-ask-sort" disabled={sort?.busy} onClick={sortNow}><Sparkle weight="bold" /> Sort Unsorted</button>
        {answer && !answer.busy && (
          <button type="button" onClick={() => { const chatId = answer.chatId; close(); setAsking(false); navigate('Assistant', { chatId }) }}><ChatCircle /> Keep talking</button>
        )}
        <small>
          {label
            ? `Answers come from ${label}.`
            : <>No AI yet: sorting uses matching words. <button type="button" onClick={() => { setAsking(false); navigate('Settings', { section: 'ai' }) }}>Set up the AI</button></>}
        </small>
      </footer>
    </section>
  )
}
