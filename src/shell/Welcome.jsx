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
  const [bar, setBar] = useState('⌥⇧Space')

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
    window.osatDesk?.prefs?.().then((prefs) => {
      if (prefs?.label) setHotkey(prefs.label)
      if (prefs?.search?.label) setBar(prefs.search.label)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    ref.current?.querySelector('[data-autofocus]')?.focus()
  }, [step])

  const next = <button className="primary-button" type="button" data-autofocus onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight /></button>

  return (
    <div className="modal-backdrop welcome-backdrop">
      <section ref={ref} className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <ol className="welcome-steps" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((index) => <li key={index} className={index === step ? 'is-on' : ''} />)}
        </ol>
        {step === 0 && (
          <>
            <span className="welcome-icon"><LockKey weight="fill" /></span>
            <h2 id="welcome-title">Your work and your life, in one place.</h2>
            <p>Write anything and OSAT puts it where it goes: a to-do, your calendar, the right board. Today shows what needs you. Everything stays on this Mac, the AI too: no account, nothing sent anywhere.</p>
            <div className="welcome-actions">{next}</div>
          </>
        )}
        {step === 1 && (
          <>
            <span className="welcome-icon"><Keyboard weight="fill" /></span>
            <h2 id="welcome-title">{hotkey}, from anywhere.</h2>
            <p>Press it in any app to bring OSAT up. {bar} opens the quick bar over whatever you are doing: type to find anything, ⌘Return to ask the AI, ⌥Return to save a sticky. Esc puts either away. Try it now if you like; this will wait.</p>
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
