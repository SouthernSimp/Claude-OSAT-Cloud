import { useCallback, useEffect, useState } from 'react'
import { getLocalModels } from '../local-ai.js'

/* What Ask can use right now: `models` (null while looking), `offline` (Offline mode) and,
   in the Mac app, `status` of the built-in AI (its size, download and whether it is awake). */
export function useAi() {
  const bridge = typeof window === 'undefined' ? null : window.osatLocalAI
  const [status, setStatus] = useState(null)
  const [models, setModels] = useState(null)
  const [offline, setOffline] = useState(false)
  const refresh = useCallback(() => {
    getLocalModels().then(setModels, () => setModels([]))
  }, [])

  useEffect(() => {
    refresh()
    if (!bridge?.status) return undefined
    bridge.status().then(setStatus).catch(() => {})
    return bridge.onStatus(setStatus)
  }, [bridge, refresh])

  // Picking a model in Settings → Bots (or going offline, which sets a cloud model aside)
  // changes which one answers: the list is read again, so the line asks the new first one.
  useEffect(() => (typeof window === 'undefined' ? undefined : window.osatBots?.onStatus?.(refresh)), [refresh])

  // Offline mode pauses the AI's download, so what the AI can do says so.
  useEffect(() => {
    const under = typeof window === 'undefined' ? null : window.osatUnder
    if (!under) return undefined
    under.status().then((value) => setOffline(Boolean(value?.on))).catch(() => {})
    return under.onChange?.((value) => { setOffline(Boolean(value?.on)); refresh() })
  }, [refresh])

  // A finished download (or a new size) changes what Ask can use.
  const readyKey = `${status?.chosen}:${status?.tiers.map((tier) => `${tier.id}:${tier.ready}:${tier.state}`).join(',')}`
  useEffect(() => { if (status) refresh() }, [readyKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { status, models, offline, refresh, bridge }
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
