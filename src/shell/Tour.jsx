import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight } from '@phosphor-icons/react'

import { useFocusTrap } from '../lib/use-focus-trap.js'
import { cardSpot, TOUR, tourWords } from './tour-model.js'
import '../styles/tour.css'

/* The browser preview has no Mac app to remember it, so it keeps the tour here. */
const TOUR_KEY = 'osat.tour.v1'
export function tourSeenHere() {
  try { return localStorage.getItem(TOUR_KEY) === 'seen' } catch { return true }
}
export function rememberTour() {
  window.osatApp?.toured?.().catch(() => {})
  try { localStorage.setItem(TOUR_KEY, 'seen') } catch { /* a convenience only */ }
}

/* Does this Mac still need the tour? The app remembers it (prefs.json, next to the welcome); the
   preview asks localStorage. Resolves false when unsure, so a tour never surprises anyone twice. */
export async function needsTour() {
  if (window.osatApp?.needsTour) {
    try { return (await window.osatApp.needsTour()) === true } catch { return false }
  }
  return !tourSeenHere()
}

/* A few short cards over the desk, each pointing at the real thing. Next and Back, or the arrow
   keys; Esc or "Skip the tour" ends it at any time, and it is remembered either way. */
export function Tour({ onDone }) {
  const root = useRef(null)
  const card = useRef(null)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [spot, setSpot] = useState(null)
  const [keys, setKeys] = useState({})
  const step = TOUR[index]
  const last = index === TOUR.length - 1

  const finish = useCallback(() => { rememberTour(); onDone() }, [onDone])
  useFocusTrap(root, true, finish)

  useEffect(() => {
    window.osatDesk?.prefs?.().then((prefs) => setKeys({ desk: prefs?.label, search: prefs?.search?.label })).catch(() => {})
  }, [])

  /* What the card points at, measured again if the window changes size. */
  const measure = useCallback(() => {
    const found = step.target ? document.querySelector(step.target) : null
    const box = found?.getBoundingClientRect()
    setRect(box && box.width ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null)
  }, [step])
  useLayoutEffect(measure, [measure])
  useEffect(() => {
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [measure])

  useLayoutEffect(() => {
    const size = card.current?.getBoundingClientRect()
    if (size) setSpot(cardSpot(rect, { w: size.width, h: size.height }, { w: innerWidth, h: innerHeight }))
  }, [rect, index, keys])

  useEffect(() => { root.current?.querySelector('[data-autofocus]')?.focus() }, [index])

  useEffect(() => {
    const key = (event) => {
      if (event.key === 'ArrowRight' && !last) { event.preventDefault(); setIndex((value) => value + 1) }
      if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); setIndex((value) => value - 1) }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [index, last])

  const words = tourWords(step, keys)
  const pad = 8
  return (
    <div ref={root} className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <div
        className={`tour-hole ${rect ? '' : 'is-none'}`}
        style={rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.right - rect.left + pad * 2, height: rect.bottom - rect.top + pad * 2 } : undefined}
        aria-hidden="true"
      />
      <section ref={card} className="tour-card" data-side={spot?.side} style={spot ? { left: spot.left, top: spot.top } : { visibility: 'hidden' }}>
        <ol className="welcome-steps" aria-label={`Step ${index + 1} of ${TOUR.length}`}>
          {TOUR.map((item, at) => <li key={item.id} className={at === index ? 'is-on' : ''} />)}
        </ol>
        <h2 id="tour-title">{words.title}</h2>
        <p id="tour-body">{words.body}</p>
        <div className="tour-actions">
          <button type="button" className="ghost-button" onClick={finish}>Skip the tour</button>
          <span />
          {index > 0 && <button type="button" className="ghost-button" onClick={() => setIndex(index - 1)}>Back</button>}
          <button type="button" className="primary-button" data-autofocus onClick={() => (last ? finish() : setIndex(index + 1))}>
            {last ? 'Done' : 'Next'} {!last && <ArrowRight />}
          </button>
        </div>
      </section>
    </div>
  )
}
