import { useEffect, useState } from 'react'

import { cleanError } from '../../assistant/useAi.js'
import { Group, Row, Switch } from './parts.jsx'

/* Settings → AI: While you sleep (Phase 53, desktop/overnight.cjs). On unless turned off; Think now
   for trying it without waiting for the night. Only an AI on this Mac reads for it. Only in the Mac app. */
export function OvernightSettings({ showUndo }) {
  const bridge = window.osatOvernight
  const [status, setStatus] = useState(null)
  const [thinking, setThinking] = useState(false)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    if (!bridge) return undefined
    bridge.status().then(setStatus, () => {})
    return bridge.onChange(setStatus)
  }, [bridge])
  if (!bridge) return null

  const set = (patch) => {
    setProblem('')
    bridge.set(patch).then(setStatus, (error) => setProblem(cleanError(error)))
  }
  async function thinkNow() {
    setThinking(true)
    setProblem('')
    try {
      const next = await bridge.think()
      setStatus(next)
      const count = next.ideas.length
      showUndo?.(count ? `OSAT left ${count === 1 ? 'an idea' : `${count} ideas`} on your canvas` : 'Nothing new to suggest just now', null)
    } catch (error) {
      setProblem(cleanError(error))
    } finally {
      setThinking(false)
    }
  }

  const noAi = status && !status.ai
  return (
    <Group title="While you sleep" note={problem || (noAi ? 'It needs an AI on this Mac: choose a size below, or start LM Studio. It never uses a cloud model.' : 'Only the AI on this Mac reads for it, and nothing changes until you keep an idea.')}>
      <Row title="Think it over at night" hint="Each night, on the charger, OSAT leaves a few ideas on your canvas." words="overnight night sleep ideas connect suggest links topics dream">
        <Switch label="Think it over at night" checked={status?.on === true} disabled={!status} onChange={(on) => set({ on })} />
      </Row>
      <Row title="Think now" hint="Looks over this week right away, in place of last night’s ideas." words="overnight think now ideas">
        <button className="outline-button" type="button" disabled={thinking || status?.thinking || !status || noAi} onClick={thinkNow}>{thinking || status?.thinking ? 'Thinking…' : 'Think now'}</button>
      </Row>
    </Group>
  )
}
