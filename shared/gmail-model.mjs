/* Gmail, signed in directly (Phase 86): what the Gmail API sends, as the Mail room's own messages (mail-model.mjs
   cleans them the same way as the Mac Mail app's). Plain text only: a message sent only as HTML has its tags, styles
   and scripts taken out, and nothing in it is loaded or turned into a link. Pure; desktop/gmail.cjs does the asking. */

export const GMAIL_ID = /^[0-9a-f]{6,32}$/

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const decodeEntities = (text) => String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
  if (name[0] === '#') {
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
  }
  return ENTITIES[name.toLowerCase()] ?? whole
})

const header = (message, name) => (message?.payload?.headers || []).find((item) => String(item.name).toLowerCase() === name)?.value || ''

/* What mail-model's messageRow reads: { id, subject, sender, date, unread, snippet }. */
export function gmailRaw(message) {
  if (!GMAIL_ID.test(String(message?.id || ''))) return null
  const at = Number(message.internalDate)
  return {
    id: message.id,
    subject: header(message, 'subject'),
    sender: header(message, 'from'),
    date: at > 0 ? new Date(at).toISOString() : '',
    unread: Array.isArray(message.labelIds) && message.labelIds.includes('UNREAD'),
    snippet: decodeEntities(message.snippet),
  }
}

/* An HTML part as plain words: no styles or scripts, a line break for each block, entities read. */
export function htmlText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+/g, ' ')
}

/* The body's words: the plain-text part when there is one, else the HTML part read as words. `decode` turns
   Gmail's base64url into text (Buffer in the main process). */
export function bodyText(payload, decode) {
  let plain = ''
  let html = ''
  const walk = (part, depth = 0) => {
    if (!part || depth > 8) return
    const type = String(part.mimeType || '').toLowerCase()
    if (part.body?.data && !part.filename) {
      if (type === 'text/plain' && !plain) plain = decode(part.body.data)
      else if (type === 'text/html' && !html) html = decode(part.body.data)
    }
    for (const child of part.parts || []) walk(child, depth + 1)
  }
  walk(payload)
  return plain || htmlText(html)
}

/* What mail-model's messageFull reads: the row plus the body. */
export function gmailFull(message, decode) {
  const raw = gmailRaw(message)
  return raw ? { ...raw, body: bodyText(message.payload, decode) } : null
}

/* Gmail's own page for a message, in the account it came from. */
export const gmailLink = (id, email) => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email || '')}#all/${GMAIL_ID.test(id) ? id : ''}`
