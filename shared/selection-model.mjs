/* AI on selected text (Phase 51, like Raycast's AI commands): what the AI can do with words selected in any app, and
   the one message each sends. The answer is only the new text, so Return can paste it over the selection. Pure. */

export const TEXT_ACTIONS = [
  { id: 'fix', label: 'Fix spelling and grammar', also: 'fix typo spell grammar correct proofread', ask: 'Fix the spelling and grammar of the text. Keep its meaning, tone, language and formatting.', replace: true },
  { id: 'shorter', label: 'Make it shorter', also: 'shorter concise trim tighten brief', ask: 'Rewrite the text to be noticeably shorter while keeping what matters.', replace: true },
  { id: 'clearer', label: 'Make it clearer', also: 'clearer simplify plain improve rewrite', ask: 'Rewrite the text in plain, clear words.', replace: true },
  { id: 'friendly', label: 'Make it friendlier', also: 'friendly warm casual tone', ask: 'Rewrite the text in a warmer, friendlier tone.', replace: true },
  { id: 'professional', label: 'Make it more professional', also: 'professional formal work tone business', ask: 'Rewrite the text in a professional tone.', replace: true },
  { id: 'list', label: 'Turn it into a list', also: 'list bullets points', ask: 'Turn the text into a short bulleted list.', replace: true },
  { id: 'summarize', label: 'Summarize', also: 'summary summarize tldr gist', ask: 'Summarize the text in two or three sentences.', replace: false },
  { id: 'explain', label: 'Explain it', also: 'explain meaning what does understand', ask: 'Explain what the text means in plain words, briefly.', replace: false },
  { id: 'english', label: 'Translate to English', also: 'translate english language', ask: 'Translate the text to English.', replace: true },
  { id: 'reply', label: 'Write a reply', also: 'reply respond answer email message', ask: 'Write a short, friendly reply to this message.', replace: false },
]

const RULES = 'Answer with only the result: no introduction, no quotes around it, no notes after it.'

/* The rows for the bar: the actions the typed words match, and, when words are typed, the words themselves as an
   instruction ("make it rhyme") first. */
export function textActionRows(query = '') {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = TEXT_ACTIONS.filter((action) => words.every((word) => `${action.label} ${action.also}`.toLowerCase().includes(word)))
  const rows = found.map((action) => ({ key: `text:${action.id}`, source: 'selection', kind: 'text-action', title: action.label, subtitle: action.replace ? 'Return pastes it over the selection' : 'Return copies it', section: 'AI on selected text', data: { id: action.id } }))
  if (words.length) rows.unshift({ key: 'text:own', source: 'selection', kind: 'text-action', title: `“${String(query).trim().slice(0, 60)}”`, subtitle: 'Your own instruction', section: 'AI on selected text', data: { id: 'own', ask: String(query).trim().slice(0, 500) } })
  return rows
}

/* The messages for one action on the selected text. */
export function textMessages(data, text) {
  const action = TEXT_ACTIONS.find((item) => item.id === data?.id)
  const ask = action ? action.ask : String(data?.ask || '').trim()
  return [
    { role: 'system', content: `You change or answer about a piece of text the person selected. ${RULES}` },
    { role: 'user', content: `${ask}\n\nThe text:\n"""\n${String(text).slice(0, 20000)}\n"""` },
  ]
}

export const replaces = (data) => (data?.id === 'own' ? true : Boolean(TEXT_ACTIONS.find((item) => item.id === data?.id)?.replace))

/* A model may still wrap the answer in quotes or a fence; take them off. */
export function cleanAnswer(answer) {
  let text = String(answer || '').trim()
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text)
  if (fence) text = fence[1].trim()
  if (/^"""[\s\S]*"""$/.test(text)) text = text.slice(3, -3).trim()
  else if (/^"[^"]*"$/.test(text)) text = text.slice(1, -1)
  return text
}
