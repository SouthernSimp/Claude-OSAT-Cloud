/* Mail read straight from the provider over IMAP (Phase 104): iCloud, Gmail, Yahoo or any server, with an app password.
   Pure, so the window can show the same choices main connects to. desktop/imap-mail.cjs does the talking. */

/* `web` opens the provider's own mail page; `compose` starts a reply there when the provider has a page for it, else
   Reply falls back to a mailto: link (whatever mail app the Mac opens those in). */
export const PROVIDERS = {
  icloud: {
    label: 'iCloud Mail', host: 'imap.mail.me.com', web: 'https://www.icloud.com/mail/',
    help: 'https://support.apple.com/en-us/102654', helpLabel: 'Make an app-specific password at account.apple.com',
  },
  gmail: {
    label: 'Gmail', host: 'imap.gmail.com', web: 'https://mail.google.com/mail/u/0/',
    compose: (to, subject) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}`,
    help: 'https://myaccount.google.com/apppasswords', helpLabel: 'Make an app password in your Google Account',
  },
  yahoo: {
    label: 'Yahoo Mail', host: 'imap.mail.yahoo.com', web: 'https://mail.yahoo.com/',
    compose: (to, subject) => `https://compose.mail.yahoo.com/?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}`,
    help: 'https://help.yahoo.com/kb/SLN15241.html', helpLabel: 'Make an app password in Yahoo’s Account Security',
  },
  other: { label: 'Your mail', host: '', web: '', help: '', helpLabel: '' },
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

/* The provider an address most likely uses, to pick for the person. */
export function providerFor(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase() || ''
  if (/^(icloud|me|mac)\.com$/.test(domain)) return 'icloud'
  if (/^(gmail|googlemail)\.com$/.test(domain)) return 'gmail'
  if (/^(yahoo|ymail|rocketmail)\.|^yahoo\./.test(domain)) return 'yahoo'
  return 'other'
}

/* What the connect form sends, checked before anything leaves the Mac. → { provider, email, password, host } or { error }. */
export function cleanSignIn(raw) {
  const provider = Object.hasOwn(PROVIDERS, raw?.provider) ? raw.provider : null
  const email = typeof raw?.email === 'string' ? raw.email.trim() : ''
  const password = typeof raw?.password === 'string' ? raw.password.replace(/\s+/g, '') : ''
  const host = provider === 'other' ? String(raw?.host || '').trim().toLowerCase() : PROVIDERS[provider]?.host
  if (!provider) return { error: 'Pick where your mail is.' }
  if (!EMAIL.test(email) || email.length > 200) return { error: 'That doesn’t look like an email address.' }
  if (!password || password.length > 200) return { error: 'Paste the app password.' }
  if (!HOST.test(host || '')) return { error: 'Type your mail server, like imap.example.com.' }
  return { provider, email, password, host }
}

/* One fetched message (imapflow's shape) as what mail-model's messageRow reads. */
export function imapRaw(message) {
  const from = message?.envelope?.from?.[0] || {}
  const sender = from.address ? (from.name ? `${from.name} <${from.address}>` : from.address) : from.name || ''
  const at = message?.internalDate || message?.envelope?.date
  const date = at ? new Date(at) : null
  return {
    id: message?.uid,
    subject: message?.envelope?.subject || '',
    sender,
    date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : '',
    unread: !(message?.flags instanceof Set ? message.flags.has('\\Seen') : false),
    snippet: '',
  }
}

/* Where Reply goes for a message from `address` about `subject`. */
export function replyLink(provider, address, subject) {
  const re = /^re:/i.test(subject || '') ? subject : `Re: ${subject || ''}`.trim()
  const compose = PROVIDERS[provider]?.compose
  if (compose) return compose(address || '', re)
  if (PROVIDERS[provider]?.web) return PROVIDERS[provider].web
  return `mailto:${encodeURIComponent(address || '')}?subject=${encodeURIComponent(re)}`
}

/* Why it couldn't connect, in the provider's own words. */
export function explainImap(error, provider) {
  if (error?.authenticationFailed) {
    return provider === 'icloud' ? 'iCloud didn’t take that password. Use an app-specific password, not your Apple Account password.'
      : provider === 'other' ? 'Your mail server didn’t take that address and password.'
        : `${PROVIDERS[provider]?.label || 'Your mail'} didn’t take that password. Use an app password, not your usual one.`
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(error?.code || '')) return 'That mail server couldn’t be found. Check its name, or your connection.'
  return 'Your mail couldn’t be reached just now. Try again in a moment.'
}
