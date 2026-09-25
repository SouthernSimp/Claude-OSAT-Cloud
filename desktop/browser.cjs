const { WebContentsView, session } = require('electron')

/* The in-app browser: real Chromium tabs in their own session, laid over the
   Browser room. Pages never see OSAT's data, get no special permissions, and
   only open http(s) addresses. The renderer tells us where the page area is;
   we keep the active tab there and hide every tab when the room is covered. */

const WEB = /^https?:\/\//i
const CLIP_SCRIPT = `(() => {
  const pick = (name) => document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]')?.content || ''
  return {
    selection: String(window.getSelection?.() || '').slice(0, 20000),
    description: pick('description') || pick('og:description'),
    text: (document.querySelector('article, main') || document.body)?.innerText?.slice(0, 20000) || '',
  }
})()`

function createBrowser({ window, emit }) {
  const part = session.fromPartition('persist:osat-browser')
  part.setPermissionRequestHandler((_wc, permission, respond) => respond(permission === 'fullscreen' || permission === 'clipboard-sanitized-write'))
  part.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen' || permission === 'clipboard-sanitized-write')

  const tabs = new Map()
  let order = []
  let active = null
  let rect = null
  let seq = 0

  const info = (id) => {
    const { view, favicon } = tabs.get(id)
    const wc = view.webContents
    return {
      id,
      url: wc.getURL(),
      title: wc.getTitle() || wc.getURL(),
      loading: wc.isLoading(),
      canBack: wc.navigationHistory.canGoBack(),
      canForward: wc.navigationHistory.canGoForward(),
      favicon,
    }
  }
  const state = () => ({ tabs: order.map(info), active })
  const push = () => emit('browser:state', state())

  function layout() {
    for (const [id, { view }] of tabs) {
      const show = Boolean(rect) && id === active
      view.setVisible(show)
      if (show) view.setBounds(rect)
    }
  }

  function open(url = 'about:blank') {
    if (url !== 'about:blank' && !WEB.test(url)) throw new Error('Only web addresses open here.')
    const id = `tab-${++seq}`
    const view = new WebContentsView({
      webPreferences: { session: part, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
    })
    view.setBackgroundColor('#ffffff')
    tabs.set(id, { view, favicon: '' })
    order.push(id)
    window.contentView.addChildView(view)
    const wc = view.webContents
    wc.setWindowOpenHandler(({ url: next }) => {
      if (WEB.test(next)) activate(open(next))
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, next) => { if (!WEB.test(next)) event.preventDefault() })
    wc.on('page-favicon-updated', (_event, icons) => {
      const entry = tabs.get(id)
      if (entry) entry.favicon = icons.find((icon) => WEB.test(icon)) || ''
      push()
    })
    for (const name of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading', 'did-fail-load']) wc.on(name, push)
    active = id
    if (url !== 'about:blank') wc.loadURL(url)
    layout()
    push()
    return id
  }

  function activate(id) {
    if (!tabs.has(id)) return state()
    active = id
    layout()
    push()
    return state()
  }

  function close(id) {
    const entry = tabs.get(id)
    if (!entry) return state()
    window.contentView.removeChildView(entry.view)
    entry.view.webContents.close()
    tabs.delete(id)
    const index = order.indexOf(id)
    order = order.filter((item) => item !== id)
    if (active === id) active = order[Math.min(index, order.length - 1)] || null
    layout()
    push()
    return state()
  }

  const current = () => (active && tabs.get(active)?.view.webContents) || null

  return {
    state,
    open: (url) => { open(url); return state() },
    activate,
    close,
    navigate(url) {
      if (!WEB.test(url)) throw new Error('Only web addresses open here.')
      if (!current()) return open(url) && state()
      current().loadURL(url)
      return state()
    },
    back() { current()?.navigationHistory.goBack(); return state() },
    forward() { current()?.navigationHistory.goForward(); return state() },
    reload() { current()?.reload(); return state() },
    stop() { current()?.stop(); return state() },
    place(next) {
      rect = next && [next.x, next.y, next.width, next.height].every(Number.isFinite) && next.width > 0 && next.height > 0
        ? { x: Math.round(next.x), y: Math.round(next.y), width: Math.round(next.width), height: Math.round(next.height) }
        : null
      layout()
      return true
    },
    async clip() {
      const wc = current()
      if (!wc || !WEB.test(wc.getURL())) throw new Error('Open a page to clip it.')
      const [page] = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: CLIP_SCRIPT }]).then((value) => [value]).catch(() => [{}])
      return { url: wc.getURL(), title: wc.getTitle(), selection: page?.selection || '', description: page?.description || '', text: page?.text || '' }
    },
    destroy() {
      for (const id of [...order]) close(id)
    },
  }
}

module.exports = { createBrowser }
