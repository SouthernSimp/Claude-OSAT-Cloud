import { useCallback, useEffect, useState } from 'react'
import { getLocalModels } from '../local-ai.js'

/* What Ask can use right now: `models` (null while looking) and, in the Mac app,
   `status` of the built-in AI (its size, download and whether it is awake). */
export function useAi() {
  const bridge = typeof window === 'undefined' ? null : window.osatLocalAI
  const [status, setStatus] = useState(null)
  const [models, setModels] = useState(null)
  const refresh = useCallback(() => {
    getLocalModels().then(setModels, () => setModels([]))
  }, [])

  useEffect(() => {
    refresh()
    if (!bridge?.status) return undefined
    bridge.status().then(setStatus).catch(() => {})
    return bridge.onStatus(setStatus)
  }, [bridge, refresh])

  // A finished download (or a new size) changes what Ask can use.
  const chosen = status?.tiers.find((tier) => tier.id === status.chosen)
  const readyKey = `${status?.chosen}:${Boolean(chosen?.ready)}`
  useEffect(() => { if (status) refresh() }, [readyKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { status, models, refresh, bridge }
}

/* One calm line about the built-in AI while it is being set up, or null. */
export function setupLine(status) {
  const download = status?.download
  if (!download) return null
  const percent = Math.floor((download.received / download.total) * 100)
  if (download.state === 'running') return `Setting up the AI · ${percent}%`
  if (download.state === 'paused') return `AI download paused at ${percent}%`
  return 'The AI download stopped'
}

export const cleanError = (error) => String(error?.message || error || 'That did not work.')
  .replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
