/* Conversation storage for the local assistant.
   Kept in its own IndexedDB database, separate from the workspace, because chat
   history is device-local and is deliberately excluded from workspace exports. */

const DB_NAME = 'osat-field-chats'
const STORE = 'conversations'
const MAX_MESSAGES = 200

export const newConversation = (overrides = {}) => ({
  id: `chat-${crypto.randomUUID()}`,
  title: '',
  messages: [],
  contextIds: [],
  includeContext: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

/* First line of the opening question, trimmed to something a sidebar can show. */
export function deriveTitle(conversation) {
  if (conversation.title?.trim()) return conversation.title.trim()
  const first = conversation.messages.find((message) => message.role === 'user')?.content || ''
  const line = first.trim().split('\n').find((value) => value.trim()) || ''
  const clean = line.replace(/[#*`_>]/g, '').trim()
  if (!clean) return 'New chat'
  return clean.length > 52 ? `${clean.slice(0, 52).trimEnd()}…` : clean
}

function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('This browser has no local database for chat history.'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open chat history.'))
  })
}

function run(mode, work) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = work(transaction.objectStore(STORE))
        transaction.oncomplete = () => {
          db.close()
          resolve(request?.result)
        }
        transaction.onerror = () => {
          db.close()
          reject(transaction.error || new Error('Chat history operation failed.'))
        }
        transaction.onabort = () => {
          db.close()
          reject(transaction.error || new Error('Chat history operation was aborted.'))
        }
      }),
  )
}

function normalize(value) {
  if (!value || typeof value.id !== 'string') return null
  const messages = (Array.isArray(value.messages) ? value.messages : [])
    .filter(
      (message) =>
        message &&
        ['user', 'assistant'].includes(message.role) &&
        typeof message.content === 'string',
    )
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      id: typeof message.id === 'string' ? message.id : `m-${crypto.randomUUID()}`,
      role: message.role,
      content: message.content,
      at: typeof message.at === 'string' ? message.at : new Date().toISOString(),
      savedNoteId: typeof message.savedNoteId === 'string' ? message.savedNoteId : undefined,
    }))
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : '',
    messages,
    contextIds: Array.isArray(value.contextIds) ? value.contextIds.filter((id) => typeof id === 'string') : [],
    includeContext: value.includeContext === true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  }
}

export async function listConversations() {
  const all = await run('readonly', (store) => store.getAll())
  return (all || [])
    .map(normalize)
    .filter(Boolean)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function saveConversation(conversation) {
  const clean = normalize(conversation)
  if (!clean) return Promise.resolve(null)
  return run('readwrite', (store) => store.put(clean)).then(() => clean)
}

export function deleteConversation(id) {
  return run('readwrite', (store) => store.delete(id))
}

export function searchConversations(conversations, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return conversations
  return conversations.filter(
    (conversation) =>
      deriveTitle(conversation).toLowerCase().includes(needle) ||
      conversation.messages.some((message) => message.content.toLowerCase().includes(needle)),
  )
}
