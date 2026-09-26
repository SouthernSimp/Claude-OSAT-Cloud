import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Keyboard, LockKey, Sparkle } from '@phosphor-icons/react'

import { useFocusTrap } from '../lib/use-focus-trap.js'
import { AiSizes } from '../views/Settings.jsx'

/* The first launch on a Mac: what stays private, the shortcut, and the AI's size.
   Three calm steps; Esc or "Not now" skips the rest, and Settings has it all later. */
export function Welcome({ onDone }) {
  const ref = useRef(null)
  const [step, setStep] = useState(0)
  const [ai, setAi] = useState(null)
  const [tier, setTier] = useState(null)
  const [hotkey, setHotkey] = useState('⌥Space')

  const done = useRef(onDone)
  done.current = onDone
  const finish = useCallback((choice) => {
    window.osatApp?.welcomed?.().catch(() => {})
    if (choice) window.osatLocalAI?.choose?.(choice).catch(() => {})
    done.current()
  }, [])
  const skip = useCallback(() => finish(null), [finish])
  useFocusTrap(ref, true, skip)

  useEffect(() => {
    window.osatLocalAI?.status?.().then((status) => {
      setAi(status)
      setTier(status.chosen || status.recommended)
    }).catch(() => {})
    window.osatOverlay?.prefs?.().then((prefs) => { if (prefs?.label) setHotkey(prefs.label) }).catch(() => {})
  }, [])

  useEffect(() => {
    ref.current?.querySelector('[data-autofocus]')?.focus()
  }, [step])

  const next = <button className="primary-button" type="button" data-autofocus onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight /></button>

  return (
    <div className="modal-backdrop welcome-backdrop">
      <section ref={ref} className="glass welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <ol className="welcome-steps" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((index) => <li key={index} className={index === step ? 'is-on' : ''} />)}
        </ol>
        {step === 0 && (
          <>
            <span className="welcome-icon"><LockKey weight="fill" /></span>
            <h2 id="welcome-title">Everything stays on this Mac.</h2>
            <p>Your notes live in one folder here and save as you type. The AI runs here too. No account, no cloud, nothing sent anywhere.</p>
            <div className="welcome-actions">{next}</div>
          </>
        )}
        {step === 1 && (
          <>
            <span className="welcome-icon"><Keyboard weight="fill" /></span>
            <h2 id="welcome-title">{hotkey}, from anywhere.</h2>
            <p>Press it in any app to drop a thought, find something or ask. Esc puts it away. Try it now if you like; this will wait.</p>
            <div className="welcome-actions">{next}</div>
          </>
        )}
        {step === 2 && (
          <>
            <span className="welcome-icon"><Sparkle weight="fill" /></span>
            <h2 id="welcome-title">Pick the AI’s size.</h2>
            <p>It downloads once, in the background, and OSAT works as usual meanwhile. You can change it any time in Settings.</p>
            {ai && <AiSizes status={ai} value={tier} onChoose={setTier} />}
            <div className="welcome-actions">
              <button className="ghost-button" type="button" onClick={skip}>Not now</button>
              <button className="primary-button" type="button" data-autofocus disabled={!tier} onClick={() => finish(tier)}>Start <ArrowRight /></button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
