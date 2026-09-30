import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHalf, DotsSixVertical, Globe, Monitor, Moon, Sun } from '@phosphor-icons/react'

import { useDrop } from '../lib/carry.js'
import { SETTINGS, SPACES, TOOLS, spaceFor } from '../lib/spaces.js'
import { DOCK_SIDES, nearestSide } from './dock-model.js'
import { magnify, unmagnify } from './glass.jsx'
import { ToolsWheel } from './ToolsWheel.jsx'

/* The desk's chrome: one dock, and the appearance controls (light or dark, how much blur)
   that Settings shows. The dock sits at the bottom, or on the left or right edge (`side`): drag it by its grip, or pick a
   side in Tools. Tools is a wheel with a line for each tool. */

export const DEFAULT_BLUR = 60
export function Dock({ view, navigate, storage, aiReady, extra = [], onSendUp, side = 'bottom', onSide, children }) {
  const dock = useRef(null)
  const [carried, setCarried] = useState(null)
  const current = spaceFor(view)?.id || 'Today'
  const inTools = TOOLS.some((tool) => tool.id === current && tool.id !== 'Browser') || current === SETTINGS.id || spaceFor(view)?.dock === false
  const vertical = side !== 'bottom'

  /* The soft pill behind the current space glides to the next one. */
  useLayoutEffect(() => {
    const node = dock.current
    const target = node?.querySelector('[aria-current="page"]')
    if (!node || !target) return
    const from = node.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    node.style.setProperty('--pill-x', `${Math.round(box.left - from.left)}px`)
    node.style.setProperty('--pill-w', `${Math.round(box.width)}px`)
    node.style.setProperty('--pill-y', `${Math.round(box.top - from.top)}px`)
    node.style.setProperty('--pill-h', `${Math.round(box.height)}px`)
  }, [current, side])

  /* Pick the dock up by its grip; where it is let go, the nearest edge keeps it. A tap does nothing. */
  function carry(event) {
    if (event.button !== 0) return
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY }
    let moved = false
    let last = side
    const at = (next) => ({ x: next.clientX, y: next.clientY, side: nearestSide({ x: next.clientX, y: next.clientY }, { width: innerWidth, height: innerHeight }) })
    const move = (next) => {
      if (!moved && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 6) return
      moved = true
      const now = at(next)
      last = now.side
      setCarried(now)
    }
    const end = (next) => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', end)
      removeEventListener('pointercancel', end)
      setCarried(null)
      if (moved && next.type === 'pointerup') onSide?.(last)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', end)
    addEventListener('pointercancel', end)
  }

  const home = carried && dock.current?.offsetParent?.getBoundingClientRect()
  const wheel = [
    ...[...SPACES.filter((space) => space.dock === false), ...TOOLS.filter((tool) => tool.id !== 'Browser')].map((tool) => ({ id: tool.id, label: tool.label, icon: tool.icon, hint: tool.hint, checked: current === tool.id, onSelect: () => navigate(tool.id) })),
    ...extra.map((item) => ({ id: item.label, label: item.label, icon: item.icon, hint: item.hint || '', checked: item.checked, onSelect: item.onSelect })),
    { id: 'Appearance', label: 'Appearance', icon: CircleHalf, hint: 'Light or dark, the backdrop and the blur', onSelect: () => navigate(SETTINGS.id, { section: 'appearance' }) },
    { id: SETTINGS.id, label: SETTINGS.label, icon: SETTINGS.icon, hint: SETTINGS.hint, keys: '⌘,', checked: current === SETTINGS.id, onSelect: () => navigate(SETTINGS.id) },
  ]

  return (
    <>
      <nav
        ref={dock}
        className={`glass liquid dock app-dock ${carried ? 'is-carried' : ''}`}
        data-side={side}
        aria-label="OSAT"
        style={carried && home ? { left: carried.x - home.left, top: carried.y - home.top, bottom: 'auto', right: 'auto', translate: '-50% -50%' } : undefined}
        onPointerMove={(event) => magnify(event, vertical)}
        onPointerLeave={unmagnify}
      >
        <span className="dock-pill" aria-hidden="true" />
        <button
          type="button"
          className="dock-grip"
          aria-label="Move the dock"
          data-tip={'Drag to move the dock\nor use the arrow keys'}
          onPointerDown={carry}
          onKeyDown={(event) => {
            const next = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'bottom' }[event.key]
            if (next) { event.preventDefault(); onSide?.(next) }
          }}
        >
          <DotsSixVertical weight="bold" />
        </button>
        {SPACES.map((space, index) => space.dock !== false && (
          <DockSpace key={space.id} space={space} index={index} current={current} aiReady={aiReady} navigate={navigate} onSendUp={space.id === 'Mindmap' ? onSendUp : null} />
        ))}
        <button type="button" data-mag data-space="Browser" data-tip="The web, right here" aria-current={current === 'Browser' ? 'page' : undefined} onClick={(event) => navigate('Browser', null, { from: event.currentTarget.getBoundingClientRect() })}>
          <Globe weight={current === 'Browser' ? 'fill' : 'regular'} />
          <span className="dock-label">Web</span>
        </button>
        <ToolsWheel items={wheel} side={side} onSide={onSide} active={inTools} />
        {children}
        {/* Saving is invisible unless it fails; then a calm dot leads to what to do. */}
        {storage?.status === 'error' && (
          <button type="button" className="dock-status error" data-tip="Saving needs attention" aria-label={`Saving needs attention. ${storage.message || ''}`} onClick={() => navigate('Settings', { section: 'data' })}>
            <i />
          </button>
        )}
      </nav>
      {carried && createPortal(
        <div className="dock-targets" aria-hidden="true">
          {DOCK_SIDES.map((edge) => <i key={edge} data-edge={edge} data-on={carried.side === edge || undefined} />)}
        </div>,
        document.body,
      )}
    </>
  )
}

/* One space on the dock. The Sky's takes a sticky: rest on it and the Sky comes down to
   meet you, or drop it there to set it down freely on the Sky. */
function DockSpace({ space, index, current, aiReady, navigate, onSendUp }) {
  const drop = useDrop(`dock:${space.id}`, {
    accepts: onSendUp ? ['note'] : [],
    onDrop: ({ id }) => onSendUp(id),
    spring: onSendUp ? () => navigate(space.id) : undefined,
  })
  return (
    <button
      type="button"
      data-mag
      data-space={space.id}
      data-tip={`${space.hint}  ⌘${index + 1}`}
      aria-current={current === space.id ? 'page' : undefined}
      className={space.id === 'Assistant' && aiReady ? 'is-running' : undefined}
      onClick={(event) => navigate(space.id, null, { from: event.currentTarget.getBoundingClientRect() })}
      {...(onSendUp ? drop : {})}
    >
      <space.icon weight={current === space.id ? 'fill' : 'regular'} />
      <span className="dock-label">{space.label}</span>
    </button>
  )
}

export const BACKDROPS = [['', 'Your desktop'], ['sonoma', 'Sonoma'], ['dusk', 'Dusk'], ['sea', 'Sea'], ['meadow', 'Meadow']]

/* Light or dark, and how much the desktop behind OSAT blurs (Settings → Appearance). */
export function AppearanceControls({ workspace, commit }) {
  const settings = workspace.settings || {}
  const blur = Number.isFinite(settings.blur) ? settings.blur : DEFAULT_BLUR
  const set = (patch) => commit((state) => ({ ...state, settings: { ...(state.settings || {}), ...patch } }))
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Light or dark">
        {[['system', 'Auto', Monitor], ['light', 'Light', Sun], ['dark', 'Dark', Moon]].map(([id, label, Icon]) => (
          <button key={id} type="button" role="radio" aria-checked={workspace.theme === id} onClick={() => commit((state) => ({ ...state, theme: id }))}>
            <Icon weight={workspace.theme === id ? 'fill' : 'regular'} />{label}
          </button>
        ))}
      </div>
      <p className="pop-kicker">Backdrop</p>
      <div className="backdrop-picks" role="radiogroup" aria-label="Backdrop">
        {BACKDROPS.map(([id, label]) => (
          <button key={id || 'mac'} type="button" role="radio" data-swatch={id || 'mac'} aria-checked={(settings.backdrop || '') === id} onClick={() => set({ backdrop: id })}>
            <i aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <p className="pop-kicker">Desk</p>
      <label className="blur-control">
        <span>Blur <output>{blur === 0 ? 'Clear' : blur >= 90 ? 'Deep' : `${blur}%`}</output></span>
        <input type="range" min="0" max="100" step="5" value={blur} onChange={(event) => set({ blur: Number(event.target.value) })} />
      </label>
    </>
  )
}
