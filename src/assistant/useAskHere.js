import { useEffect, useRef, useState } from 'react'

import { streamLocalMessage } from '../local-ai.js'
import { isActiveNote } from '../notes-model.js'
import { extractActions, systemPrompt, wantsActions } from './actions.js'
import { askContext } from './ask-context.js'
import { findForAsk, sourceRefs } from './ask-find.js'
import { newChat, newMessage, outbound, putChat } from './chats.js'
import { cleanError } from './useAi.js'
import { notesForQuestion } from './work-scope.js'

/* Ask, right here (the desk's line, the Sky's): the answer streams into a card and is kept as
   a chat, so nothing said is lost and "Keep talking" picks it up in Ask. The question reads
   the notes it matches and, through `context` (boardMap's options), what is open in the Sky.
   `answer` is { chatId, question, text, busy, error, noteIds, actions, savedId } or null. */
export function useAskHere({ workspace, commit, modelId, context, local = true }) {
  const [answer, setAnswer] = useState(null)
  const abort = useRef(null)
  useEffect(() => () => abort.current?.abort(), [])

  async function ask(question) {
    abort.current?.abort()
    const active = workspace.notes.filter(isActiveNote)
    const scoped = notesForQuestion(workspace, question, context)
    const noteIds = scoped.slice(0, 8).map((note) => note.id)
    const controller = new AbortController()
    abort.current = controller
    const chat0 = `chat-${crypto.randomUUID()}`
    const update = (patch) => setAnswer((value) => (value?.chatId === chat0 ? { ...value, ...patch } : value))
    setAnswer({ chatId: chat0, question, text: '', busy: true, error: '', noteIds, copies: [], files: [], omitted: scoped.length - noteIds.length, actions: [], savedId: null })
    // Copies and files (only with a model on this Mac): the question shows "Thinking…" while they are looked up.
    const found = context?.scope === 'none' ? await findForAsk('', false) : await findForAsk(question, local)
    if (controller.signal.aborted) { update({ busy: false }); return }
    const chat = { ...newChat({ modelId }), id: chat0, contextScope: { kind: context?.scope || 'workspace', ...(context?.focus ? { folderId: context.focus } : {}) }, messages: [newMessage('user', question, { ...(noteIds.length ? { noteIds } : {}), ...sourceRefs(found) })] }
    commit((state) => putChat(state, chat))
    update({ copies: found.copies, files: found.files })
    let full = ''
    try {
      await streamLocalMessage({
        model: modelId,
        messages: outbound(systemPrompt(new Date(), workspace.settings?.aboutMe || '', askContext(workspace, question, { ...context, noteIds })), [], question, active, noteIds, [], workspace.folders, found.text),
        signal: controller.signal,
        onDelta: (delta) => { full += delta; update({ text: extractActions(full).body }) },
      })
    } catch (reason) {
      if (reason?.name !== 'AbortError') update({ error: cleanError(reason) })
    }
    const { body, actions } = extractActions(full)
    update({ busy: false, text: body, actions: wantsActions(question) ? actions : [] })
    if (!body.trim()) return
    commit((state) => {
      const saved = (state.chats || []).find((item) => item.id === chat.id) || chat
      return putChat(state, { ...saved, messages: [...saved.messages, newMessage('assistant', body, { modelId })] })
    })
  }

  return {
    answer,
    setAnswer,
    ask,
    stop: () => abort.current?.abort(),
    close() { abort.current?.abort(); setAnswer(null) },
  }
}
