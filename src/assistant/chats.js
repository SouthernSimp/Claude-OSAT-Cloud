/* Ask's conversations. They live in the workspace (`workspace.chats`), so every
   window sees the same history and it travels with backups. Pure helpers only. */

const MAX_MESSAGES = 200

export const newChat = (overrides = {}) => {
  const now = new Date().toISOString()
  return { id: `chat-${crypto.randomUUID()}`, title: '', messages: [], createdAt: now, updatedAt: now, ...overrides }
}

export const newMessage = (role, content, extra = {}) => ({
  id: `m-${crypto.randomUUID()}`, role, content, at: new Date().toISOString(), ...extra,
})

/* First line of the opening question, trimmed to something a sidebar can show. */
export function deriveTitle(chat) {
  if (chat.title?.trim()) return chat.title.trim()
  const first = chat.messages.find((message) => message.role === 'user')?.content || ''
  const line = first.trim().split('\n').find((value) => value.trim()) || ''
  const clean = line.replace(/[#*`_>]/g, '').trim()
  if (!clean) return 'New chat'
  return clean.length > 52 ? `${clean.slice(0, 52).trimEnd()}…` : clean
}

const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
const ids = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string').slice(0, 8) : [])

/* Deterministic, so loading a workspace never rewrites chats that were fine. */
export function normalizeChat(value) {
  if (!value || typeof value.id !== 'string' || !value.id) return null
  const messages = (Array.isArray(value.messages) ? value.messages : [])
    .filter((message) => message && typeof message.id === 'string' && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      at: text(message.at),
      ...(ids(message.noteIds).length ? { noteIds: ids(message.noteIds) } : {}),
      ...(typeof message.savedNoteId === 'string' ? { savedNoteId: message.savedNoteId } : {}),
    }))
  return { id: value.id, title: text(value.title), messages, createdAt: text(value.createdAt), updatedAt: text(value.updatedAt, text(value.createdAt)) }
}

/* Adds the chat or replaces it, stamping the time it changed. */
export function putChat(state, chat) {
  const next = { ...chat, updatedAt: new Date().toISOString() }
  const chats = state.chats || []
  return { ...state, chats: chats.some((item) => item.id === chat.id) ? chats.map((item) => (item.id === chat.id ? next : item)) : [next, ...chats] }
}

export const removeChat = (state, id) => ({ ...state, chats: (state.chats || []).filter((chat) => chat.id !== id) })

export const newestFirst = (chats) => [...(chats || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))

export function searchChats(chats, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return chats
  return chats.filter((chat) => deriveTitle(chat).toLowerCase().includes(needle)
    || chat.messages.some((message) => message.content.toLowerCase().includes(needle)))
}

/* What the model reads: the notes Ask picked for this question, trimmed to fit. */
export function notesContext(notes, noteIds) {
  const chosen = noteIds.map((id) => notes.find((note) => note.id === id)).filter(Boolean)
  return chosen.map((note) => `NOTE: ${note.title || 'Untitled'}\n${String(note.markdown || '').slice(0, 1600)}`).join('\n\n').slice(0, 12000)
}

/* The messages sent to the model: the system prompt, the conversation so far,
   and the new question with the chosen notes attached. */
export function outbound(system, history, question, notes, noteIds) {
  const context = noteIds.length ? notesContext(notes, noteIds) : ''
  return [
    { role: 'system', content: system },
    ...history.filter((message) => message.content.trim()).slice(-20).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: context ? `${question}\n\n[FROM MY NOTES — use them if they help]\n${context}` : question },
  ]
}
