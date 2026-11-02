import { askLocalModel } from '../local-ai.js'
import { ASK_MAIL_COUNT, findMessages, mailboxMessages, readFind } from '../../shared/mail-model.mjs'

const UNAVAILABLE = 'Set up the AI in Settings → AI to ask your mail.'

/* Ask your mail (Phase 108). Step one (writeSearch): the AI on this Mac turns Nate's words into a search (it sees no
   mail); findMail runs it over every connected account. `query` is '' when the words were about recent mail in general:
   the newest mail is what comes back. `ask` is injectable for tests; only the AI on this Mac ever answers. */
export async function writeSearch(question, { operators = false, signal, ask = askLocalModel } = {}) {
  const messages = findMessages(question, { operators })
  return messages ? readFind(await ask(messages, { signal, unavailableMessage: UNAVAILABLE })) : ''
}
export async function findMail(bridge, question, options = {}) {
  const query = await writeSearch(question, options)
  return { query, rows: query ? await bridge.search(query, false) : await bridge.list() }
}

/* Steps two and three: the first few found messages are read and quoted for the AI, which answers from them.
   `sources` are the rows it was shown, in the order it numbered them. */
export async function askMail(bridge, question, { operators = false, signal, onDelta, onFound, ask = askLocalModel } = {}) {
  const found = await findMail(bridge, question, { operators, signal, ask })
  onFound?.(found)
  const top = found.rows.slice(0, ASK_MAIL_COUNT)
  const read = await Promise.allSettled(top.map((row) => bridge.read(row.id)))
  const sources = top.filter((_, at) => read[at].status === 'fulfilled')
  const messages = mailboxMessages(question, read.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])))
  if (!messages) return { ...found, sources: [], answer: '' }
  return { ...found, sources, answer: String(await ask(messages, { signal, onDelta, unavailableMessage: UNAVAILABLE }) || '').trim() }
}
