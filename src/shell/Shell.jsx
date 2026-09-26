import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CircleHalf, HourglassMedium, LockSimple, MagnifyingGlass, Monitor, Moon, MoonStars, Plus, ShareNetwork, Sun, Toolbox, X,
} from '@phosphor-icons/react'

import { Menu } from '../lib/Menu.jsx'
import { SETTINGS, SPACES, TOOLS, spaceFor } from '../lib/spaces.js'
import { magnify, unmagnify } from './glass.jsx'

/* The window's chrome: one dock, and every room as a sheet that rises over the
   desk from wherever you asked for it, then sinks back into it. */

export const DEFAULT_BLUR = 60
export const WALLPAPERS = [
  { id: 'lake', label: 'Lake', src: './images/wall-lake.jpg' },
  { id: 'moss', label: 'Moss', src: './images/wall-moss.jpg' },
]

export function Dock({ view, navigate, storage, aiReady, onSearch, onCapture, onFocus, workspace, commit }) {
  const dock = useRef(null)
  const current = spaceFor(view)?.id || 'Today'
  const inTools = TOOLS.some((tool) => tool.id === current) || current === SETTINGS.id

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
      {SPACES.map((space, index) => (
        <button
          key={space.id}
          type="button"
          data-mag
          data-space={space.id}
          data-tip={`${space.hint}  ⌘${index + 1}`}
          aria-current={current === space.id ? 'page' : undefined}
          className={space.id === 'Assistant' && aiReady ? 'is-running' : undefined}
          onClick={() => navigate(space.id)}
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
          ...TOOLS.map((tool) => ({ label: tool.label, icon: tool.icon, checked: current === tool.id, onSelect: () => navigate(tool.id) })),
          { label: 'Focus for 25 minutes', icon: HourglassMedium, onSelect: onFocus },
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
      <i className="dock-rule" />
      <button type="button" data-mag data-tip="Find anything  ⌘K" onClick={onSearch}>
        <MagnifyingGlass />
        <span className="dock-label">Find</span>
      </button>
      <Appearance workspace={workspace} commit={commit} />
      <button type="button" data-mag className="dock-new" data-tip="A new thought  ⇧⌘N" onClick={onCapture}>
        <Plus weight="bold" />
        <span className="dock-label">Capture</span>
      </button>
      <span className={`dock-status ${storage?.status || ''}`} role="status" data-tip={storage?.status === 'error' ? 'Check storage' : 'Saved on this Mac'} title={storage?.message}>
        <i />
        <span className="visually-hidden">{storage?.status === 'error' ? `Check storage. ${storage.message || ''}` : 'Saved on this Mac'}</span>
      </span>
    </nav>
  )
}

/* Light or dark, the wallpaper, and how much the desk blurs. The dock and
   Settings show the same controls. */
export function AppearanceControls({ workspace, commit }) {
  const settings = workspace.settings || {}
  const blur = Number.isFinite(settings.blur) ? settings.blur : DEFAULT_BLUR
  const wallpaper = settings.wallpaper === 'moss' ? 'moss' : 'lake'
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
      <div className="wall-picks" role="radiogroup" aria-label="Wallpaper">
        {WALLPAPERS.map((wall) => (
          <button key={wall.id} type="button" role="radio" aria-checked={wallpaper === wall.id} aria-label={wall.label} onClick={() => set({ wallpaper: wall.id })}>
            <img src={wall.src} alt="" />
            <span>{wall.label}</span>
          </button>
        ))}
      </div>
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

/* A room, floating over the desk. It grows out of the point you clicked. */
export function RoomSheet({ view, title, origin, closing, filled, onClose, onClosed, onRisen, onSearch, onMode, children }) {
  const sheet = useRef(null)
  const map = view === 'Mindmap' || view === 'Sky'

  useLayoutEffect(() => {
    const node = sheet.current
    if (!node || !origin) return
    const box = node.getBoundingClientRect()
    node.style.setProperty('--ox', `${Math.round(origin.x - box.left)}px`)
    node.style.setProperty('--oy', `${Math.round(origin.y - box.top)}px`)
  }, [origin])

  return (
    <section
      ref={sheet}
      className={`glass room-sheet ${closing ? 'is-closing' : ''}`}
      aria-label={title}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return
        if (closing) onClosed()
        else onRisen?.()
      }}
    >
      <header className="sheet-bar">
        <button type="button" className="sheet-close" aria-label={`Close ${title}`} data-tip="Back to the desk  esc" onClick={onClose}><X weight="bold" /></button>
        <h1 className="sheet-title" tabIndex={-1}>{title}</h1>
        {map && (
          <div className="glass liquid segmented sheet-modes" role="radiogroup" aria-label="How to see the map">
            <button type="button" role="radio" aria-checked={view === 'Mindmap'} onClick={() => onMode('Mindmap')}><ShareNetwork weight={view === 'Mindmap' ? 'fill' : 'regular'} />Board</button>
            <button type="button" role="radio" aria-checked={view === 'Sky'} onClick={() => onMode('Sky')}><MoonStars weight={view === 'Sky' ? 'fill' : 'regular'} />Sky</button>
          </div>
        )}
        <span className="sheet-private"><LockSimple /> Only on this Mac</span>
        <button type="button" className="sheet-search" onClick={onSearch}><MagnifyingGlass /><span>Find</span><kbd>⌘K</kbd></button>
      </header>
      <div className={`sheet-body workspace-content ${filled ? 'is-filled' : ''}`} data-view={view}>{children}</div>
    </section>
  )
}
