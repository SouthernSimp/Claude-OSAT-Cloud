/* The one workspace client for this window, shared by every component. */
import { useEffect, useSyncExternalStore } from 'react'
import { reconcileBoards } from '../board-model.js'
import { normalizeWorkspace } from '../osat-data.js'
import { createStoreClient } from './client.js'
import { pickBridge } from './bridges.js'

/* Boards follow Notes: whenever notes, folders or boards change, cards are added or removed to match. */
export function keepBoardsInStep(next, previous) {
  if (previous && next.notes === previous.notes && next.folders === previous.folders && next.sorter === previous.sorter) return next
  const sorter = reconcileBoards(next)
  return sorter === next.sorter ? next : { ...next, sorter }
}

let client = null

export function workspaceClient() {
  if (!client) {
    client = createStoreClient(pickBridge(), {
      normalize: normalizeWorkspace,
      prepare: keepBoardsInStep,
      afterRemote: (state) => keepBoardsInStep(state, null),
    })
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
  useEffect(() => {
    if (workspace?.theme) {
      try { localStorage.setItem('osat.theme', workspace.theme) } catch { /* first-paint hint only */ }
    }
  }, [workspace?.theme])
  return { workspace, status, commit: store.commit, replace: store.replace, ready: status.ready }
}
