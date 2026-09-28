import { useEffect, useState } from 'react'
import { ArrowUp, Detective } from '@phosphor-icons/react'

import { useReducedMotion } from '../field/FieldChrome.jsx'
import { FieldSky } from '../field/FieldSky.jsx'
import { Line } from '../field/Line.jsx'

/* Incognito: the place under the desk, OSAT with the internet off. The Sky fills the
   screen, the same line waits at the bottom (notes only; a thought written here is saved
   with the source 'Under' and its star glows warmer), and a pill at the top says where
   you are, with Come up. Desk.jsx lifts the desk away and says when to arrive or leave;
   this plays the rest: the ink rises with its waterline, then the Sky, then the pill.
   In the browser preview there is no main process, so it is the look only. */
export function Under({ workspace, commit, navigate, storage, status, arriving, leaving, visit, summon, onOpenNote, onComeUp }) {
  const reduced = useReducedMotion()
  // 0: the ink is rising, 1: the Sky, 2: the pill and the line.
  const [stage, setStage] = useState(arriving && !reduced ? 0 : 2)
  useEffect(() => {
    if (stage === 2) return undefined
    const timers = [setTimeout(() => setStage(1), 480), setTimeout(() => setStage(2), 900)]
    return () => timers.forEach(clearTimeout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const preview = !window.osatUnder

  return (
    <div className={`under ${arriving ? 'is-arriving' : ''} ${leaving ? 'is-leaving' : ''}`} inert={leaving || undefined}>
      <div className="under-ink" aria-hidden="true" />
      {stage >= 1 && <div className="under-sky"><FieldSky workspace={workspace} navigate={navigate} full /></div>}
      {stage >= 2 && (
        <>
          <header className="under-top">
            <div className="under-pill">
              <Detective weight="fill" aria-hidden="true" />
              <p><strong>Incognito</strong> · {preview ? 'Preview' : 'offline · nothing leaves OSAT'}</p>
              <button type="button" title={preview ? undefined : 'Come up  ⇧⌘U'} onClick={onComeUp}>Come up <ArrowUp weight="bold" /></button>
            </div>
            <p className="under-detail">
              {preview ? 'The look only. In the Mac app, OSAT goes offline down here.' : 'Other apps, LM Studio too, keep their own connections.'}
              {status?.terminal && ' A terminal you started is still running.'}
            </p>
          </header>
          <div className="under-line">
            {/* Ready to type into on arrival, and again each time the desk is shown (⌥Space). */}
            <Line workspace={workspace} commit={commit} navigate={navigate} storage={storage} visit={visit + 1} summon={summon} under onOpenNote={onOpenNote} />
          </div>
        </>
      )}
    </div>
  )
}
