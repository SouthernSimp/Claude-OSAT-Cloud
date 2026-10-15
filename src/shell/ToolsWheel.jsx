import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLineDown, ArrowLineLeft, ArrowLineRight, Toolbox } from '@phosphor-icons/react'

/* Every tool is visible together; arrow keys move between the native menu buttons. */
export function ToolsWheel({ items, side = 'bottom', onSide, active: inTools }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const list = useRef(null)
  const close = useCallback(() => setOpen(false), [])

  /* Esc and a click elsewhere let it go, and everything else (the desk's Esc, the line) waits meanwhile. */
  useEffect(() => {
    if (!open) return undefined
    document.documentElement.dataset.menu = 'open'
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    const key = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); root.current?.querySelector('[data-space="tools"]')?.focus() } }
    addEventListener('pointerdown', outside, true)
    addEventListener('keydown', key, true)
    return () => { delete document.documentElement.dataset.menu; removeEventListener('pointerdown', outside, true); removeEventListener('keydown', key, true) }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const rows = list.current?.querySelectorAll('[role="menuitem"]')
    rows?.[Math.max(0, items.findIndex((item) => item.checked))]?.focus()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (item) => { setOpen(false); item.onSelect?.() }

  return (
    <span className={`menu-root dock-more tools-root is-${side}`} ref={root}>
      <button type="button" data-mag data-space="tools" aria-haspopup="menu" aria-expanded={open} aria-current={inTools ? 'page' : undefined} onClick={() => setOpen((value) => !value)}>
        <Toolbox weight={inTools ? 'fill' : 'regular'} />
        <span className="dock-label">Tools</span>
      </button>
      {open && (
        <div className="tools-wheel" data-side={side}>
          <div
            ref={list}
            className="tools-list"
            role="menu"
            aria-label="Tools"
            tabIndex={0}
            onKeyDown={(event) => {
              // A grid of tiles: ← → step one, ↑ ↓ a whole row (the grid's columns, read from its layout).
              if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const rows = [...list.current.querySelectorAll('[role="menuitem"]')]
              const at = Math.max(0, rows.indexOf(document.activeElement))
              const columns = Math.max(1, getComputedStyle(list.current).gridTemplateColumns.split(' ').length)
              const step = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1 }[event.key] || 0
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.min(Math.max(at + step, 0), rows.length - 1)
              rows[next]?.focus()
            }}
          >
            {items.map((item) => (
              <button key={item.id} type="button" role="menuitem" aria-label={item.label} title={item.hint} className={`tools-row tools-app ${item.checked ? 'is-here' : ''}`} tabIndex={-1} style={{ '--i': items.indexOf(item) }} onClick={() => choose(item)}>
                <i className="tile" data-tint={item.tint || 'slate'} aria-hidden="true"><item.icon weight="fill" /></i>
                <span><b>{item.label}</b></span>
              </button>
            ))}
          </div>
          <footer className="tools-foot">
            <span>Dock</span>
            {[['left', 'On the left', ArrowLineLeft], ['bottom', 'At the bottom', ArrowLineDown], ['right', 'On the right', ArrowLineRight]].map(([id, label, Icon]) => (
              <button key={id} type="button" aria-label={`Move the dock: ${label}`} title={label} aria-pressed={side === id} onClick={() => { onSide?.(id); close() }}><Icon /></button>
            ))}
          </footer>
        </div>
      )}
    </span>
  )
}
