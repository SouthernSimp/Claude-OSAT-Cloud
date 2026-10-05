import { useSyncExternalStore } from 'react'
import { ArrowClockwise, Check, DownloadSimple } from '@phosphor-icons/react'
import { downloadFile } from '../lib/ui.js'
import { workspaceClient } from './useWorkspace.js'

export function SaveStatus({ recovery = false }) {
  const store = workspaceClient()
  const { status } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (recovery && status.state !== 'error') return null
  if (!recovery) return <span className={`writing-save is-${status.state}`} role="status" title={status.message || 'Saved locally'}>{status.state === 'saved' && <Check />}{status.state === 'error' ? 'Couldn’t save' : status.state === 'saving' ? 'Saving…' : status.state === 'saved' ? 'Saved locally' : 'Opening…'}</span>
  return <aside className="writing-recovery" role="alert" aria-label="Unsaved changes">
    <p>{status.message}</p>
    <div><button type="button" onClick={() => store.retry()}><ArrowClockwise /> Retry saving</button><button type="button" onClick={() => downloadFile('OSAT-recovered-workspace.json', JSON.stringify(store.workspace, null, 2), 'application/json')}><DownloadSimple /> Export a copy</button></div>
  </aside>
}
