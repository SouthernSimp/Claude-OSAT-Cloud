import { useCallback, useEffect, useState } from 'react'

import { fileWords, wants } from '../../shared/quick-search-model.mjs'

/* What each of the Mac's sources answers for the words typed in the quick search: Spotlight's files (or
   the recent ones when nothing is typed), the clipboard history and the apps. Notes and nodes are the
   desk's own and are found on the spot, not here. `visit` counts how often the panel was shown, so
   each visit looks again. The last answer stays until the next one arrives, so the list never flickers. */
export function useSources({ bridge, read, settings, fileFilter, visit }) {
  const want = wants(read, settings, { fileFilter })
  const words = read.scope === 'files' ? fileWords(read.query, fileFilter) : read.query
  const [files, setFiles] = useState([])
  const [recent, setRecent] = useState([])
  const [clipboard, setClipboard] = useState({ items: [], paused: false })
  const [apps, setApps] = useState([])
  const [processes, setProcesses] = useState([])
  const [menus, setMenus] = useState(null)
  const [looking, setLooking] = useState(false)

  useEffect(() => {
    if (!bridge || !want.files) { setFiles([]); setLooking(false); return undefined }
    let live = true
    setLooking(true)
    const timer = setTimeout(() => {
      bridge.files(words).then(
        (items) => { if (live) { setFiles(Array.isArray(items) ? items : []); setLooking(false) } },
        () => { if (live) { setFiles([]); setLooking(false) } },
      )
    }, 150)
    return () => { live = false; clearTimeout(timer) }
  }, [bridge, want.files, words])

  useEffect(() => {
    if (!bridge || !want.recentFiles) return undefined
    let live = true
    bridge.files('').then((items) => { if (live) setRecent(Array.isArray(items) ? items : []) }, () => {})
    return () => { live = false }
  }, [bridge, want.recentFiles, visit])

  const loadClipboard = useCallback(() => bridge?.clipboard().then((list) => setClipboard(list && Array.isArray(list.items) ? list : { items: [], paused: false }), () => {}), [bridge])
  // Looked at again when the panel is shown, and when the Clipboard tab is picked.
  useEffect(() => { if (want.clipboard) loadClipboard() }, [want.clipboard, visit, read.scope, loadClipboard])

  useEffect(() => {
    if (!bridge || !want.apps) return undefined
    let live = true
    bridge.apps().then((list) => { if (live) setApps(Array.isArray(list) ? list : []) }, () => {})
    return () => { live = false }
  }, [bridge, want.apps, visit])

  // Running apps (Kill Process): looked at again on every visit and after one is ended.
  const loadProcesses = useCallback(() => bridge?.processes?.().then((list) => setProcesses(Array.isArray(list) ? list : []), () => {}), [bridge])
  useEffect(() => { if (want.processes) loadProcesses() }, [want.processes, visit, loadProcesses])
  // Keys for this app: its menus, read again each time the view opens (the app behind the bar may have changed).
  useEffect(() => {
    if (!want.menus) return undefined
    let live = true
    setMenus(null)
    bridge?.menus?.().then((value) => { if (live) setMenus(value?.items ? value : { app: value?.app || '', items: [], error: value?.error || 'NONE' }) }, () => { if (live) setMenus({ app: '', items: [], error: 'FAILED' }) })
    return () => { live = false }
  }, [want.menus, visit, bridge])

  return { found: { files, recentFiles: recent, clipboard, apps, processes, menus }, looking, reloadClipboard: loadClipboard, reloadProcesses: loadProcesses }
}
