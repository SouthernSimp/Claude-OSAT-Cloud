import { useEffect, useRef, useState } from 'react'

/* OSAT's small kit of things with character (Phase 113), built from scratch after the interface studies Nate liked
   (dqnamo's Kitchen has no license, so none of its code is used). Each has one job, a keyboard path and a still
   version for reduced motion. Styles in styles/kit.css. */

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/* Hold to confirm: for the few things that can't be undone (a download deleted, a key taken out of the Keychain). The
   colour fills while you hold the mouse or Return/Space; letting go early rolls it back; a full hold does it.
   It replaces a "Are you sure?" box (Calm rule 2). */
export function HoldButton({ children, onConfirm, duration = 1200, disabled = false, className = '', title }) {
  const [state, setState] = useState('idle')
  const timer = useRef(null)
  const holding = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  const start = () => {
    if (disabled || holding.current || state === 'done') return
    holding.current = true
    setState('holding')
    timer.current = setTimeout(() => {
      holding.current = false
      setState('done')
      onConfirm()
      timer.current = setTimeout(() => setState('idle'), 1600)
    }, still() ? 600 : duration)
  }
  const stop = () => {
    if (!holding.current) return
    holding.current = false
    clearTimeout(timer.current)
    setState('idle')
  }
  return (
    <button
      type="button"
      className={`hold-button ${className}`}
      data-state={state}
      style={{ '--hold': `${still() ? 600 : duration}ms` }}
      disabled={disabled}
      title={title || 'Hold to confirm'}
      aria-busy={state === 'holding'}
      onPointerDown={(event) => { if (event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); start() } }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); start() } }}
      onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') stop() }}
      onBlur={stop}
    >
      <span className="hold-face">{state === 'done' ? 'Done' : children}</span>
      <span className="hold-fill" aria-hidden="true">{state === 'done' ? 'Done' : children}</span>
    </button>
  )
}

/* Words that settle into place: when `text` changes, its letters shuffle for a moment, then land. Screen readers get
   the final words only. */
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
export function ScrambleText({ text, className = '' }) {
  const [shown, setShown] = useState(text)
  useEffect(() => {
    if (still()) { setShown(text); return undefined }
    let frame = 0
    let step = 0
    const steps = 14
    const tick = () => {
      step += 1
      const settled = Math.floor((step / steps) * text.length)
      setShown(text.split('').map((letter, index) => (index < settled || letter === ' ' ? letter : GLYPHS[(index * 7 + step * 13) % GLYPHS.length])).join(''))
      if (step < steps) frame = requestAnimationFrame(() => setTimeout(tick, 28))
      else setShown(text)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [text])
  return (
    <span className={`scramble ${className}`}>
      <span aria-hidden="true">{shown}</span>
      <span className="visually-hidden">{text}</span>
    </span>
  )
}

/* A button whose words change (Check for updates → Looking… → Up to date) and which glides to its new width instead
   of jumping. */
export function GlideButton({ children, className = 'outline-button', ...props }) {
  const inner = useRef(null)
  const [width, setWidth] = useState(null)
  useEffect(() => {
    const node = inner.current
    if (!node || typeof ResizeObserver !== 'function') return undefined
    const watch = new ResizeObserver(() => setWidth(node.offsetWidth))
    watch.observe(node)
    return () => watch.disconnect()
  }, [])
  return (
    <button type="button" className={`glide-button ${className}`} style={width ? { '--glide-w': `${width}px` } : undefined} {...props}>
      <span ref={inner} className="glide-inner">{children}</span>
    </button>
  )
}
