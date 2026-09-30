// A stand-in for what the Mac app gives the quick search (`window.osatSearch`), so the web preview can show and
// test the panel: a few files, a clipboard, some apps. Every call it doesn't know is recorded in window.__calls.
export function installSearchBridge() {
  const at = (hours) => new Date(Date.now() - hours * 3600000).toISOString()
  const picture = (color, words) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="%23${color}"/><text x="30" y="60" font-size="28">${words}</text></svg>`
  const clipboard = [
    { id: 'c1', kind: 'text', at: at(0.1), text: 'Jordan asked for the revised quote by Friday, and wants the delivery date in writing.', chars: 84, app: 'Mail' },
    { id: 'c2', kind: 'link', at: at(2), text: 'https://osat.example/pricing', chars: 28, app: 'Safari' },
    { id: 'c3', kind: 'email', at: at(30), text: 'jordan@acme.com', chars: 15, app: 'Mail', pinned: true },
    { id: 'c4', kind: 'image', at: at(5), image: { w: 300, h: 400, bytes: 1000 }, thumb: picture('bfe0f7', 'A copied picture') },
  ]
  const files = {
    taxes: { rootId: 'documents', relative: 'Taxes/Taxes 2025.pdf', name: 'Taxes 2025.pdf', kind: 'file', size: 1258291, modifiedAt: '2026-09-20T10:00:00Z', where: 'Documents › Taxes' },
    trip: { rootId: 'desktop', relative: 'Trip notes.md', name: 'Trip notes.md', kind: 'file', size: 400, modifiedAt: '2026-09-28T10:00:00Z', where: 'Desktop' },
  }
  window.__calls = []
  window.__shown = () => {}
  const known = {
    ready: async () => true,
    settings: async () => null,
    onSettings: () => () => {},
    onShown: (listener) => { window.__shown = listener; return () => {} },
    onEscape: () => () => {},
    // The desk hears of a new copy; a test calls window.__copied({ id, kind, at, text }).
    onCopied: (listener) => { window.__copied = listener; return () => {} },
    files: async (query) => (query ? [files.taxes] : [files.trip]),
    preview: async (root, relative) => (relative.endsWith('.md') ? { text: '# Trip\nLeave Friday\nBring the tent', thumb: null } : { text: null, thumb: picture('f9c6cc', 'Taxes 2025') }),
    apps: async () => [{ name: 'Notes', path: '/Applications/Notes.app' }, { name: 'Spotify', path: '/Applications/Spotify.app' }],
    appIcon: async () => null,
    clipboard: async () => ({ paused: false, watching: true, items: clipboard }),
    clipboardImage: async (id) => clipboard.find((item) => item.id === id).thumb,
    clipboardText: async (id) => clipboard.find((item) => item.id === id).text,
    mode: async () => true,
    hide: async () => { window.__calls.push(['hide']); return true },
  }
  window.osatSearch = new Proxy(known, {
    get: (target, name) => (name in target ? target[name] : async (...args) => { window.__calls.push([name, ...args]); return { pasted: false, reason: 'access', undo: 'u1' } }),
  })
}
