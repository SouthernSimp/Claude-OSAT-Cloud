import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLineDown, ArrowLineLeft, ArrowLineRight, Toolbox } from '@phosphor-icons/react'

/* Tools on the dock: a wheel to scroll, one tool to a row with a line saying what it is. The tool in the middle is
   the one Return opens; rows fade and shrink as they leave the middle. Scroll it, press ↑ ↓, or click a row; Esc
   leaves. At its foot, where the dock lives (bottom, left or right). Solid, like a menu: it sits over the desk.
   `items` are { id, label, icon, hint, checked, onSelect }. */
const ROW = 56

export function ToolsWheel({ items, side = 'bottom', onSide, active: inTools }) {
  const [open, setOpen] = useState(false)
  const [middle, setMiddle] = useState(0)
  const root = useRef(null)
  const list = useRef(null)
  // The row the keys are heading for (the wheel scrolls smoothly, so the middle one lags behind quick presses).
  const target = useRef(0)
  const gliding = useRef(0)

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

  /* Rows shrink and fade with their distance from the middle line; the nearest is the picked one. */
  const settle = useCallback(() => {
    const node = list.current
    if (!node) return
    const centre = node.scrollTop + node.clientHeight / 2
    let nearest = 0
    let least = Infinity
    node.querySelectorAll('[role="menuitem"]').forEach((row, index) => {
      const distance = Math.abs(row.offsetTop + row.offsetHeight / 2 - centre)
      row.style.setProperty('--d', Math.min(1, distance / (ROW * 2)).toFixed(3))
      if (distance < least) { least = distance; nearest = index }
    })
    setMiddle(nearest)
    if (!gliding.current) target.current = nearest
  }, [])

  // Opens with the tool you are in (else the first) in the middle.
  useLayoutEffect(() => {
    if (!open) return
    const node = list.current
    const start = Math.max(0, items.findIndex((item) => item.checked))
    node.scrollTop = start * ROW
    target.current = start
    settle()
    node.focus()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (index) => {
    const at = Math.min(Math.max(index, 0), items.length - 1)
    target.current = at
    window.clearTimeout(gliding.current)
    gliding.current = window.setTimeout(() => { gliding.current = 0 }, 450)
    list.current?.scrollTo({ top: at * ROW, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
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
            onScroll={() => requestAnimationFrame(settle)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); go(target.current + 1) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); go(target.current - 1) }
              else if (event.key === 'Enter') { event.preventDefault(); if (items[target.current]) choose(items[target.current]) }
            }}
          >
            <span className="tools-pad" aria-hidden="true" />
            {items.map((item, index) => (
              <button key={item.id} type="button" role="menuitem" aria-label={item.label} className={`tools-row ${item.checked ? 'is-here' : ''} ${index === middle ? 'is-middle' : ''}`} tabIndex={-1} onClick={() => choose(item)}>
                <item.icon aria-hidden="true" />
                <span><b>{item.label}</b><small>{item.hint}</small></span>
                {item.keys && <kbd>{item.keys}</kbd>}
              </button>
            ))}
            <span className="tools-pad" aria-hidden="true" />
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
