import { useEffect, useState } from 'react'

import { DEFAULT_SETTINGS } from '../../shared/launcher-model.mjs'
import { ringItems } from '../../shared/ring-model.mjs'
import { Ring } from '../search/Ring.jsx'

/* The ring over other apps (Hyper R): a small see-through window with the tools around the pointer. Picking one, Esc,
   or clicking away puts it away; the app you were in keeps focus. The tools come from Settings → Launcher. */
export function RingSurface() {
  const ring = window.osatRing
  const search = window.osatSearch
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [visit, setVisit] = useState(0)

  useEffect(() => {
    const take = (value) => { if (value?.sources) setSettings(value) }
    search?.settings().then(take, () => {})
    const stops = [search?.onSettings(take), ring?.onShown(() => { setVisit((value) => value + 1); search?.settings().then(take, () => {}) })]
    ring?.ready()
    return () => stops.forEach((stop) => stop?.())
  }, [ring, search])

  // A panel keeps Esc from the page on the Mac; main sends it on.
  const close = () => ring?.hide()
  useEffect(() => ring?.onEscape(close), [ring]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="ring-surface">
      <Ring key={visit} items={ringItems(settings.ring.items)} onPick={(item) => ring?.pick(item.id)} onClose={close} />
    </main>
  )
}
