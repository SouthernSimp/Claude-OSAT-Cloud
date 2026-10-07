// A stand-in for what the Mac app gives the quick search (`window.osatSearch`), so the web preview can show and
// test the panel: a few files, a clipboard, some apps. Every call it doesn't know is recorded in window.__calls.
export function installSearchBridge(defaults) {
  const at = (hours) => new Date(Date.now() - hours * 3600000).toISOString()
  const picture = (color, words) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="%23${color}"/><text x="30" y="60" font-size="28">${words}</text></svg>`
  const clipboard = [
    { id: 'c1', kind: 'text', at: at(0), text: 'Jordan asked for the revised quote by Friday, and wants the delivery date in writing.', chars: 84, app: 'Mail' },
    { id: 'c2', kind: 'link', at: at(2), text: 'https://osat.example/pricing', chars: 28, app: 'Safari' },
    { id: 'c3', kind: 'email', at: at(30), text: 'jordan@acme.com', chars: 15, app: 'Mail', pinned: true },
    { id: 'c4', kind: 'image', at: at(5), image: { w: 300, h: 400, bytes: 1000 }, thumb: picture('bfe0f7', 'A copied picture') },
  ]
  const files = {
    taxes: { rootId: 'documents', relative: 'Taxes/Taxes 2025.pdf', name: 'Taxes 2025.pdf', kind: 'file', size: 1258291, modifiedAt: '2026-09-20T10:00:00Z', where: 'Documents › Taxes' },
    trip: { rootId: 'desktop', relative: 'Trip notes.md', name: 'Trip notes.md', kind: 'file', size: 400, modifiedAt: '2026-09-28T10:00:00Z', where: 'Desktop' },
  }
  let paused = false
  window.__calls = []
  window.__shown = () => {}
  // The launcher's settings as main keeps them (saved at once, and every window hears).
  let settings = defaults
  const heard = new Set()
  // What main does with a patch (shared/launcher-model.mjs `applyPatch`): one level down, an app set to null goes.
  const merge = (patch) => {
    const one = (key) => ({ ...(settings[key] || {}), ...(patch[key] || {}) })
    const apps = { ...(settings.apps || {}) }
    for (const [name, own] of Object.entries(patch.apps || {})) {
      if (own === null) delete apps[name]
      else apps[name] = { ...(apps[name] || {}), ...own }
      if (apps[name] && !apps[name].keyword && !apps[name].hotkey) delete apps[name]
    }
    return {
      ...settings,
      ...patch,
      sources: Object.fromEntries(Object.entries(settings.sources).map(([id, own]) => [id, { ...own, ...(patch.sources?.[id] || {}) }])),
      apps,
      clipboard: one('clipboard'),
      ring: one('ring'),
      hyper: one('hyper'),
      captures: { ...settings.captures, ...(patch.captures || {}), hotkeys: { ...settings.captures?.hotkeys, ...(patch.captures?.hotkeys || {}) } },
      windows: { ...settings.windows, ...(patch.windows || {}), hotkeys: { ...settings.windows.hotkeys, ...(patch.windows?.hotkeys || {}) } },
    }
  }
  const known = {
    ready: async () => true,
    settings: async () => settings,
    saveSettings: async (patch) => { settings = merge(patch); heard.forEach((listener) => listener(settings)); return settings },
    // ⌘K's favorite, key and word for one row (main's `search:customize`, kept as shared/launcher-model.mjs `customize` does).
    customize: async (row, change) => {
      window.__calls.push(['customize', row.key, change])
      const before = (settings.custom || []).find((entry) => entry.key === row.key)
      const entry = { favorite: false, hotkey: null, keyword: null, ...(before || { key: row.key, kind: row.kind, title: row.title, subtitle: row.subtitle || '', data: row.data || {} }), ...change }
      const rest = (settings.custom || []).filter((item) => item.key !== row.key)
      settings = { ...settings, custom: entry.favorite || entry.hotkey || entry.keyword ? [...rest, entry] : rest }
      heard.forEach((listener) => listener(settings))
      return settings
    },
    system: async (id) => { window.__calls.push(['system', id]); return { ok: true } },
    onSettings: (listener) => { heard.add(listener); return () => heard.delete(listener) },
    status: async () => ({ accessibility: 'needed', keysFailed: [], middleClick: 'listening' }),
    pauseClipboard: async (on) => { paused = on === true; return paused },
    clearClipboard: async () => 'undo-clear',
    onShown: (listener) => { window.__shown = listener; return () => {} },
    onEscape: () => () => {},
    // The desk hears of a new copy; a test calls window.__copied({ id, kind, at, text }).
    onCopied: (listener) => { window.__copied = listener; return () => {} },
    files: async (query) => (query ? [files.taxes] : [files.trip]),
    preview: async (root, relative) => (relative.endsWith('.md') ? { text: '# Trip\nLeave Friday\nBring the tent', thumb: null } : { text: null, thumb: picture('f9c6cc', 'Taxes 2025') }),
    apps: async () => [{ name: 'Notes', path: '/Applications/Notes.app' }, { name: 'Spotify', path: '/Applications/Spotify.app' }],
    appIcon: async () => null,
    clipboard: async () => ({ paused, watching: true, items: clipboard }),
    clipboardImage: async (id) => clipboard.find((item) => item.id === id).thumb,
    clipboardText: async (id) => clipboard.find((item) => item.id === id).text,
    askFind: async () => ({ off: false, copies: [], files: [], text: '' }),
    askSwitch: async (on) => on,
    mode: async () => true,
    // CleanShot X is on this stand-in Mac, with two recent captures (Settings → Screenshots turns them on).
    captureStatus: async () => ({ cleanshot: true, mac: true, list: ['area', 'window', 'fullscreen', 'scrolling', 'all-in-one', 'record', 'text', 'history'], recent: settings.captures?.recent === true, saveTo: 'desktop', screen: null }),
    captureRecent: async () => [{ id: 'media_a/CleanShot 1.png', name: 'CleanShot 1.png', at: Date.now() - 60000 }, { id: 'media_b/CleanShot 2.mp4', name: 'CleanShot 2.mp4', at: Date.now() - 7200000 }],
    captureThumb: async () => picture('d7e8c6', 'A screenshot'),
    capture: async (id) => { window.__calls.push(['capture', id]); return { ok: true } },
    dragClip: async (id) => { window.__calls.push(['dragClip', id]); return true },
    hide: async () => { window.__calls.push(['hide']); return true },
    // Without Accessibility the Mac app answers that it can't move a window (and touches nothing).
    snap: async (layout) => { window.__calls.push(['snap', layout]); return { ok: false, reason: 'access' } },
  }
  // The ring's own small window (Hyper R) says what was picked.
  window.osatRing = {
    ready: async () => true,
    pick: async (id) => { window.__calls.push(['ringPick', id]); return true },
    hide: async () => { window.__calls.push(['ringHide']); return true },
    onShown: (listener) => { window.__ringShown = listener; return () => {} },
    onEscape: () => () => {},
  }
  window.osatSearch = new Proxy(known, {
    get: (target, name) => (name in target ? target[name] : async (...args) => { window.__calls.push([name, ...args]); return { pasted: false, reason: 'access', undo: 'u1' } }),
  })
}
