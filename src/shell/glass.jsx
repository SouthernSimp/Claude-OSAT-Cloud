import { useEffect } from 'react'

/* The glass kit.

   Liquid glass: `.liquid` elements bend what's behind them at their edges, like
   a lens. The bend is an SVG displacement map stretched over the element: grey
   in the middle (no bend), ramping to black/red at the left and right edges and
   black/green at the top and bottom. Chromium (so the Mac app) supports it; other
   browsers simply get plain frosted glass.

   Alive: one pointer listener lights the glass under the cursor from where the
   cursor is (--mx/--my) and tilts the desk a few pixels (--px/--py). Nothing
   moves while the mouse is still. */

const RAMP = (id, axis) => {
  const [x2, y2] = axis === 'x' ? ['1', '0'] : ['0', '1']
  const channel = (v) => (axis === 'x' ? `rgb(${v},0,0)` : `rgb(0,${v},0)`)
  return `<linearGradient id='${id}' x1='0' y1='0' x2='${x2}' y2='${y2}'>`
    + `<stop offset='0' stop-color='${channel(0)}'/><stop offset='.14' stop-color='${channel(128)}'/>`
    + `<stop offset='.86' stop-color='${channel(128)}'/><stop offset='1' stop-color='${channel(255)}'/></linearGradient>`
}
const MAP = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 256 256'><defs>${RAMP('x', 'x')}${RAMP('y', 'y')}</defs>`
  + `<rect width='256' height='256' fill='url(#x)'/><rect width='256' height='256' fill='url(#y)' style='mix-blend-mode:screen'/></svg>`,
)}`

export function GlassDefs() {
  return (
    <svg className="glass-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="osat-liquid" x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
        <feImage href={MAP} preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="-28" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

let lit = null

function light(element, x, y) {
  if (lit && lit !== element) {
    lit.style.removeProperty('--mx')
    lit.style.removeProperty('--my')
  }
  lit = element
  if (!element) return
  const box = element.getBoundingClientRect()
  element.style.setProperty('--mx', `${Math.round(x - box.left)}px`)
  element.style.setProperty('--my', `${Math.round(y - box.top)}px`)
}

/* One listener for the whole window, at most once a frame. */
export function useAlive() {
  useEffect(() => {
    const root = document.documentElement
    let frame = 0
    let last = null
    const apply = () => {
      frame = 0
      if (!last) return
      const { clientX: x, clientY: y, target } = last
      root.style.setProperty('--px', (x / innerWidth * 2 - 1).toFixed(3))
      root.style.setProperty('--py', (y / innerHeight * 2 - 1).toFixed(3))
      light(target instanceof Element ? target.closest('.glass, .lit') : null, x, y)
    }
    const move = (event) => {
      last = event
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const leave = () => {
      last = null
      light(null)
      root.style.setProperty('--px', '0')
      root.style.setProperty('--py', '0')
    }
    addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
    }
  }, [])
}

/* The dock swells a little under the cursor, like the Mac's. */
export function magnify(event) {
  const dock = event.currentTarget
  for (const button of dock.querySelectorAll('[data-mag]')) {
    const box = button.getBoundingClientRect()
    const distance = Math.abs(event.clientX - (box.left + box.width / 2))
    button.style.setProperty('--mag', (1 + 0.22 * Math.max(0, 1 - distance / 110)).toFixed(3))
  }
}

export function unmagnify(event) {
  for (const button of event.currentTarget.querySelectorAll('[data-mag]')) button.style.removeProperty('--mag')
}
