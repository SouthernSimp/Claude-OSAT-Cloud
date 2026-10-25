/* What you type in the browser's address bar: a web address opens as-is, a
   bare domain gets https (http for this Mac), anything else is a search. */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i
const DOMAIN = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?([/?#].*)?$/u

/* Where a search goes (Nate's sticky, Oct 6: "select default site for browsing"). DuckDuckGo unless picked. */
export const SEARCHES = [
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  { id: 'kagi', name: 'Kagi', url: 'https://kagi.com/search?q=' },
]
export const searchUrl = (id) => (SEARCHES.find((item) => item.id === id) || SEARCHES[0]).url

export function toAddress(input, search = 'https://duckduckgo.com/?q=') {
  const text = String(input || '').trim()
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  if (LOCAL.test(text)) return `http://${text}`
  if (!/\s/.test(text) && DOMAIN.test(text)) return `https://${text}`
  return `${search}${encodeURIComponent(text)}`
}

/* A clipped page becomes an ordinary note: the title, the words you chose
   (or the page's own summary), and where it came from. */
export function clipMarkdown({ url, title, selection = '', description = '', text = '' }, when = new Date()) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } })()
  const heading = String(title || host).replace(/\s+/g, ' ').trim().slice(0, 200) || host
  const words = (selection.trim() || description.trim() || text.trim().slice(0, 1200)).replace(/\n{3,}/g, '\n\n')
  const quote = words ? `${words.split('\n').map((line) => (line.trim() ? `> ${line.trim()}` : '>')).join('\n')}\n\n` : ''
  const day = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(when)
  return { title: heading, markdown: `# ${heading}\n\n${quote}Clipped from [${host}](${url}) on ${day}. #clip` }
}
