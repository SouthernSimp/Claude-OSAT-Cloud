import { useEffect, useRef, useState } from 'react'

import { streamLocalMessage } from '../local-ai.js'
import { isActiveNote, relatedNotes } from '../notes-model.js'
import { extractActions, systemPrompt, wantsActions } from './actions.js'
import { askContext } from './ask-context.js'
import { newChat, newMessage, outbound, putChat } from './chats.js'
import { cleanError } from './useAi.js'

/* Ask, right here (the desk's line, the Sky's): the answer streams into a card and is kept as
   a chat, so nothing said is lost and "Keep talking" picks it up in Ask. The question reads
   the notes it matches and, through `context` (boardMap's options), what is open in the Sky.
   `answer` is { chatId, question, text, busy, error, noteIds, actions, savedId } or null. */
export function useAskHere({ workspace, commit, modelId, context }) {
  const [answer, setAnswer] = useState(null)
  const abort = useRef(null)
  useEffect(() => () => abort.current?.abort(), [])

  async function ask(question) {
    abort.current?.abort()
    const active = workspace.notes.filter(isActiveNote)
    const noteIds = relatedNotes(active, question).map((note) => note.id)
    const chat = { ...newChat({ modelId }), messages: [newMessage('user', question, noteIds.length ? { noteIds } : {})] }
    commit((state) => putChat(state, chat))
    const controller = new AbortController()
    abort.current = controller
    const update = (patch) => setAnswer((value) => (value?.chatId === chat.id ? { ...value, ...patch } : value))
    setAnswer({ chatId: chat.id, question, text: '', busy: true, error: '', noteIds, actions: [], savedId: null })
    let full = ''
    try {
      await streamLocalMessage({
        model: modelId,
        messages: outbound(systemPrompt(new Date(), workspace.settings?.aboutMe || '', askContext(workspace, question, context)), [], question, active, noteIds),
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
