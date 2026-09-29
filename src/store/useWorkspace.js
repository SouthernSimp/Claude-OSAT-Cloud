/* The one workspace client for this window, shared by every component. */
import { useEffect, useSyncExternalStore } from 'react'
import { normalizeWorkspace } from '../osat-data.js'
import { createStoreClient } from './client.js'
import { pickBridge } from './bridges.js'

let client = null

export function workspaceClient() {
  if (!client) {
    // The old boards (`sorter`) are no longer shown, so nothing keeps them in step with notes.
    client = createStoreClient(pickBridge(), { normalize: normalizeWorkspace })
    client.start()
    if (typeof window !== 'undefined') {
      // Hand over anything still waiting before the window closes or reloads.
      window.addEventListener('pagehide', () => client.flushNow())
    }
  }
  return client
}

export function useWorkspace() {
  const store = workspaceClient()
  const { workspace, status } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // Every OSAT window follows the workspace theme ("system" follows the Mac).
  useEffect(() => {
    const theme = workspace?.theme
    if (!theme) return undefined
    try { localStorage.setItem('osat.theme', theme) } catch { /* first-paint hint only */ }
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [workspace?.theme])
  // …and the blur Nate chose in Appearance (0 clear … 100 deep; 60 by default).
  const blur = workspace?.settings?.blur
  useEffect(() => {
    const amount = Number.isFinite(blur) ? Math.min(Math.max(blur, 0), 100) : 60
    document.documentElement.style.setProperty('--blur-n', String(amount / 100))
    document.documentElement.style.setProperty('--wall-blur', `${Math.round(amount * 0.8)}px`)
  }, [blur])
  return { workspace, status, commit: store.commit, replace: store.replace, ready: status.ready }
}

/* The top bar, the dock and Settings read a simple saving status. */
export function storageFrom(status, ready) {
  if (status.state === 'error') return { status: 'error', message: status.message }
  return { status: ready ? 'ready' : 'loading', message: status.message || (ready ? 'Saved on this Mac.' : 'Opening your workspace') }
}
