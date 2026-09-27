import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleHalf, Monitor, Moon, Sun, Toolbox } from '@phosphor-icons/react'

import { Menu } from '../lib/Menu.jsx'
import { SETTINGS, SPACES, TOOLS, spaceFor } from '../lib/spaces.js'
import { magnify, unmagnify } from './glass.jsx'

/* The desk's chrome: one dock, and the look (light or dark, how much blur). */

export const DEFAULT_BLUR = 60
export function Dock({ view, navigate, storage, aiReady, workspace, commit, extra = [], children }) {
  const dock = useRef(null)
  const current = spaceFor(view)?.id || 'Today'
  const inTools = TOOLS.some((tool) => tool.id === current) || current === SETTINGS.id || spaceFor(view)?.dock === false

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
        <button
          key={space.id}
          type="button"
          data-mag
          data-space={space.id}
          data-tip={`${space.hint}  ⌘${index + 1}`}
          aria-current={current === space.id ? 'page' : undefined}
          className={space.id === 'Assistant' && aiReady ? 'is-running' : undefined}
          onClick={(event) => navigate(space.id, null, { from: event.currentTarget.getBoundingClientRect() })}
        >
          <space.icon weight={current === space.id ? 'fill' : 'regular'} />
          <span className="dock-label">{space.label}</span>
        </button>
      ))}
      <Menu
        align="start"
        className="dock-more"
        ariaLabel="Tools"
        items={[
          ...[...SPACES.filter((space) => space.dock === false), ...TOOLS].map((tool) => ({ label: tool.label, icon: tool.icon, checked: current === tool.id, onSelect: () => navigate(tool.id) })),
          ...extra,
          { divider: true },
          { label: SETTINGS.label, icon: SETTINGS.icon, hint: '⌘,', checked: current === SETTINGS.id, onSelect: () => navigate(SETTINGS.id) },
        ]}
        trigger={({ toggle, open }) => (
          <button type="button" data-mag data-space="tools" aria-haspopup="menu" aria-expanded={open} aria-current={inTools ? 'page' : undefined} onClick={toggle}>
            <Toolbox weight={inTools ? 'fill' : 'regular'} />
            <span className="dock-label">{inTools ? spaceFor(view).label : 'Tools'}</span>
          </button>
        )}
      />
      {children}
      <i className="dock-rule" />
      <Appearance workspace={workspace} commit={commit} />
      {/* Saving is invisible unless it fails; then a calm dot leads to what to do. */}
      {storage?.status === 'error' && (
        <button type="button" className="dock-status error" data-tip="Saving needs attention" aria-label={`Saving needs attention. ${storage.message || ''}`} onClick={() => navigate('Settings', { section: 'data' })}>
          <i />
        </button>
      )}
    </nav>
  )
}

/* Light or dark, and how much the desktop behind OSAT blurs. The dock and
   Settings show the same controls. */
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
      <p className="pop-kicker">Desk</p>
      <label className="blur-control">
        <span>Blur <output>{blur === 0 ? 'Clear' : blur >= 90 ? 'Deep' : `${blur}%`}</output></span>
        <input type="range" min="0" max="100" step="5" value={blur} onChange={(event) => set({ blur: Number(event.target.value) })} />
      </label>
    </>
  )
}

export function Appearance({ workspace, commit, placement = 'up' }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    document.documentElement.dataset.menu = 'open'
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    const key = (event) => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setOpen(false) } }
    addEventListener('pointerdown', close, true)
    addEventListener('keydown', key, true)
    return () => { delete document.documentElement.dataset.menu; removeEventListener('pointerdown', close, true); removeEventListener('keydown', key, true) }
  }, [open])

  return (
    <span className="menu-root appearance" ref={root}>
      <button type="button" data-mag data-tip={open ? undefined : 'Appearance'} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
        <CircleHalf />
        <span className="dock-label">Look</span>
      </button>
      {open && (
        <div className={`glass liquid appearance-pop is-${placement}`} role="dialog" aria-label="Appearance">
          <p className="pop-kicker">Appearance</p>
          <AppearanceControls workspace={workspace} commit={commit} />
        </div>
      )}
    </span>
  )
}
