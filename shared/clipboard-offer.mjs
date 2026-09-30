/* "Add to Jordan?" (Phase 13): copy something that looks like a customer's email address or phone number
   and OSAT can offer to put it in that person's node. It only offers when a node by that name already
   exists, or when the detail is already written in one of that node's stickies; it never makes a node,
   and it never guesses from a number alone. Pure: `folders` and `notes` are the workspace's. */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi
const PHONE = /\+?\d[\d\s().-]{5,}\d/g
// Addresses everyone has: the part after @ tells nothing about who it is.
const MAILBOXES = new Set(['gmail', 'googlemail', 'yahoo', 'outlook', 'hotmail', 'live', 'msn', 'icloud', 'me', 'mac', 'aol', 'proton', 'protonmail', 'pm', 'gmx', 'mail', 'comcast', 'verizon', 'att', 'sbcglobal', 'fastmail', 'hey', 'zoho'])
// Words that start a sentence or name a role, never a person.
const NOT_NAMES = new Set(['the', 'and', 'for', 'call', 'email', 'phone', 'mobile', 'cell', 'office', 'home', 'work', 'thanks', 'hello', 'dear', 'regards', 'best', 'from', 'sent', 'subject', 'reply', 'please', 'name', 'tel', 'fax', 'sales', 'support', 'info', 'contact', 'admin', 'hi'])

const digitsOf = (text) => String(text).replace(/\D/g, '')

/* The emails and phone numbers written in a text (a phone: 7 to 15 digits, written with a space, dash or bracket, or 10+ digits). */
export function detailsIn(text) {
  const value = String(text || '').slice(0, 2000)
  const emails = [...new Set((value.match(EMAIL) || []).map((email) => email.toLowerCase()))].slice(0, 3)
  const phones = [...new Set((value.replace(EMAIL, ' ').match(PHONE) || [])
    .filter((phone) => {
      // A number, not a date or a price: 555-0102, +44 20 7946 0958, (555) 010-2299.
      const digits = digitsOf(phone).length
      if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(phone.trim())) return false
      if (digits === 7) return /^\d{3}[-. ]\d{4}$/.test(phone.trim())
      if (digits <= 9) return digits >= 8 && phone.trim().startsWith('+')
      return digits <= 15
    })
    .map(digitsOf))].slice(0, 3)
  return { emails, phones }
}

const words = (text) => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/* Names a copy could be saying: the words of an address ("jordan.lee@acme.com" → jordan, lee, jordan lee, acme) and
   the capitalised words written beside it ("Jordan Lee 555-010-2299"). Lower case; longer phrases first. */
export function namesIn(text, emails = detailsIn(text).emails) {
  const names = new Set()
  for (const email of emails) {
    const [local, domain] = email.split('@')
    const parts = local.split(/[._+-]+/).filter((part) => part.length >= 3 && /^\p{L}+$/u.test(part))
    if (parts.length > 1) names.add(parts.join(' '))
    parts.forEach((part) => names.add(part))
    const company = domain.split('.').slice(0, -1).at(-1)
    if (company && company.length >= 3 && !MAILBOXES.has(company)) names.add(company.replace(/-/g, ' '))
  }
  for (const match of String(text || '').slice(0, 600).matchAll(/\b\p{Lu}[\p{Ll}'’]{2,}(?:\s+\p{Lu}[\p{Ll}'’]{2,})*/gu)) {
    const phrase = match[0].toLowerCase()
    const list = phrase.split(/\s+/).filter((part) => !NOT_NAMES.has(part))
    if (list.length > 1) names.add(list.join(' '))
    list.forEach((part) => names.add(part))
  }
  return [...names].sort((a, b) => b.length - a.length)
}

const top = (folders, id) => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  let folder = byId.get(id)
  for (let hops = 0; folder?.parentId && hops < 20; hops += 1) folder = byId.get(folder.parentId)
  return folder || null
}

/* → { folderId, folderName, why: 'written' | 'name' } or null. `why` is 'written' when a sticky in that node already holds the
   address or number, else 'name' (a node called Jordan, and the copy says Jordan). */
export function offerFor(item, { folders = [], notes = [] } = {}) {
  if (!item || item.kind === 'image' || !item.text || !folders.length) return null
  const { emails, phones } = detailsIn(item.text)
  if (!emails.length && !phones.length) return null
  // The detail is already written in a node: that is the surest sign whose it is.
  const active = notes.filter((note) => note.folderId && !note.trashedAt)
  for (const note of active) {
    const text = `${note.title}\n${note.markdown}`.toLowerCase()
    const flat = digitsOf(text)
    if (emails.some((email) => text.includes(email)) || phones.some((phone) => flat.includes(phone))) {
      const node = top(folders, note.folderId)
      if (node) return { folderId: node.id, folderName: node.name, why: 'written' }
    }
  }
  // A node called what the copy says.
  const candidates = namesIn(item.text, emails)
  const nodes = folders.filter((folder) => !folder.parentId && folder.name.trim().length >= 3)
  for (const name of candidates) {
    const node = nodes.find((folder) => words(folder.name).join(' ') === name)
      // "Jordan Lee" is also whoever writes jordan.lee@…: every word of the node's name is in the copy.
      || nodes.find((folder) => { const own = words(folder.name); return own.length > 1 && own.every((part) => candidates.includes(part)) })
    if (node) return { folderId: node.id, folderName: node.name, why: 'name' }
  }
  return null
}

/* The words of the offer, calm and short. */
export function offerLine(item, offer) {
  const what = item.kind === 'email' ? 'an email address' : item.kind === 'phone' ? 'a phone number' : 'something with contact details'
  return `You copied ${what}. Add it to ${offer.folderName}?`
}
