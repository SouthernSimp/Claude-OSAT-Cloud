import { useEffect, useMemo, useState } from 'react'

import { liveIdeas } from '../../shared/overnight-model.mjs'

/* While you sleep (Phase 53): the ideas OSAT left overnight (desktop/overnight.cjs), only those that
   still fit the workspace. `done(idea, dismiss)`: kept (the canvas made the change) or waved away.
   Only in the Mac app; in the browser preview there are none. */
export function useOvernight(workspace) {
  const bridge = typeof window === 'undefined' ? null : window.osatOvernight
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!bridge) return undefined
    bridge.status().then(setStatus, () => {})
    return bridge.onChange(setStatus)
  }, [bridge])
  const ideas = useMemo(() => liveIdeas(workspace, status?.ideas), [workspace, status])
  return {
    ideas,
    done: (idea, dismiss) => bridge?.done(idea.id, dismiss).then(setStatus, () => {}),
    seen: () => { if (status?.unseen) bridge?.seen().then(() => setStatus((value) => value && { ...value, unseen: false }), () => {}) },
  }
}
