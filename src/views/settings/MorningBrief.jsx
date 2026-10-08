import { useEffect, useState } from 'react'

import { cleanError } from '../../assistant/useAi.js'
import { Group, Row, Switch } from './parts.jsx'
import '../../styles/morning-brief.css'

/* Settings → AI: the morning brief (Phase 49, desktop/brief.cjs). Off until turned on; a time; Write it now
   (Undo is in the toast). With no AI set up, one line says why. Only in the Mac app. */
export function MorningBriefSettings({ showUndo }) {
  const bridge = window.osatBrief
  const [status, setStatus] = useState(null)
  const [writing, setWriting] = useState(false)
  const [problem, setProblem] = useState('')
  useEffect(() => { bridge?.status().then(setStatus, () => {}) }, [bridge])
  if (!bridge) return null

  const set = (patch) => {
    setProblem('')
    bridge.set(patch).then(setStatus, (error) => setProblem(cleanError(error)))
  }
  async function writeNow() {
    setWriting(true)
    setProblem('')
    try {
      setStatus(await bridge.write())
      showUndo?.('Your morning brief is at the top of today’s journal', () => bridge.undo().catch(() => {}))
    } catch (error) {
      setProblem(cleanError(error))
    } finally {
      setWriting(false)
    }
  }

  const noAi = status && !status.ai
  return (
    <Group title="Mornings" note={problem || (noAi ? 'It needs OSAT’s AI: choose a size below, or start LM Studio.' : 'It looks at today’s calendar, Unsorted and yesterday, and changes nothing but the top of today’s page.')}>
      <Row title="Morning brief" hint="OSAT writes you a short plan for the day at the top of your journal each morning." words="brief plan day journal summary today">
        <Switch label="Morning brief" checked={status?.on === true} disabled={!status} onChange={(on) => set({ on })} />
      </Row>
      <Row title="When" hint="Once a day, after this time, as soon as your Mac is awake." words="brief time morning">
        <input type="time" className="brief-time" aria-label="When the morning brief is written" value={status?.time || '07:00'} disabled={!status} onChange={(event) => { if (event.target.value) set({ time: event.target.value }) }} />
      </Row>
      <Row title="Write it now" hint="Writes today’s brief again, in place of the one there." words="brief write now">
        <button className="outline-button" type="button" disabled={writing || !status || noAi} onClick={writeNow}>{writing ? 'Writing…' : 'Write it now'}</button>
      </Row>
    </Group>
  )
}
