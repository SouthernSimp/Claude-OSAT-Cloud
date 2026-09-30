import { useLayoutEffect, useRef } from 'react'
import { CircleHalf, Globe, Monitor, Moon, Sun, Toolbox } from '@phosphor-icons/react'

import { useDrop } from '../lib/carry.js'
import { Menu } from '../lib/Menu.jsx'
import { SETTINGS, SPACES, TOOLS, spaceFor } from '../lib/spaces.js'
import { magnify, unmagnify } from './glass.jsx'

/* The desk's chrome: one dock, and the appearance controls (light or dark, how much blur)
   that Settings shows. */

export const DEFAULT_BLUR = 60
export function Dock({ view, navigate, storage, aiReady, extra = [], onSendUp, children }) {
  const dock = useRef(null)
  const current = spaceFor(view)?.id || 'Today'
  const inTools = TOOLS.some((tool) => tool.id === current && tool.id !== 'Browser') || current === SETTINGS.id || spaceFor(view)?.dock === false

  /* The soft pill behind the current space glides to the next one. */
  useLayoutEffect(() => {
    const node = dock.current
    const target = node?.querySelector('[aria-current="page"]')
    if (!node || !target) return
    const from = node.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    node.style.setProperty('--pill-x', `${Math.round(box.left - from.left)}px`)
    node.style.setProperty('--pill-w', `${Math.round(box.width)}px`)
  }, [current])

  return (
    <nav ref={dock} className="glass liquid dock app-dock" aria-label="OSAT" onPointerMove={magnify} onPointerLeave={unmagnify}>
      <span className="dock-pill" aria-hidden="true" />
      {SPACES.map((space, index) => space.dock !== false && (
        <DockSpace key={space.id} space={space} index={index} current={current} aiReady={aiReady} navigate={navigate} onSendUp={space.id === 'Mindmap' ? onSendUp : null} />
      ))}
      <button type="button" data-mag data-space="Browser" data-tip="The web, right here" aria-current={current === 'Browser' ? 'page' : undefined} onClick={(event) => navigate('Browser', null, { from: event.currentTarget.getBoundingClientRect() })}>
        <Globe weight={current === 'Browser' ? 'fill' : 'regular'} />
        <span className="dock-label">Web</span>
      </button>
      <Menu
        align="start"
        className="dock-more"
        ariaLabel="Tools"
        items={[
          ...[...SPACES.filter((space) => space.dock === false), ...TOOLS.filter((tool) => tool.id !== 'Browser')].map((tool) => ({ label: tool.label, icon: tool.icon, checked: current === tool.id, onSelect: () => navigate(tool.id) })),
          ...extra,
          { divider: true },
          { label: 'Appearance', icon: CircleHalf, onSelect: () => navigate(SETTINGS.id, { section: 'appearance' }) },
          { label: SETTINGS.label, icon: SETTINGS.icon, hint: '⌘,', checked: current === SETTINGS.id, onSelect: () => navigate(SETTINGS.id) },
        ]}
        trigger={({ toggle, open }) => (
          <button type="button" data-mag data-space="tools" aria-haspopup="menu" aria-expanded={open} aria-current={inTools ? 'page' : undefined} onClick={toggle}>
            <Toolbox weight={inTools ? 'fill' : 'regular'} />
            <span className="dock-label">Tools</span>
          </button>
        )}
      />
      {children}
      {/* Saving is invisible unless it fails; then a calm dot leads to what to do. */}
      {storage?.status === 'error' && (
        <button type="button" className="dock-status error" data-tip="Saving needs attention" aria-label={`Saving needs attention. ${storage.message || ''}`} onClick={() => navigate('Settings', { section: 'data' })}>
          <i />
        </button>
      )}
    </nav>
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
