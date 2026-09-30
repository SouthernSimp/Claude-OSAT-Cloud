import { useEffect } from 'react'
import { ArrowsOut, Clipboard, Files, House, MagnifyingGlass, NotePencil, Sparkle, SquareHalf, TreeStructure, X } from '@phosphor-icons/react'

import { ringPositions } from '../../shared/ring-model.mjs'

const ICONS = { search: MagnifyingGlass, clipboard: Clipboard, sticky: NotePencil, chat: Sparkle, desk: House, sky: TreeStructure, files: Files, left: SquareHalf, right: SquareHalf, maximize: ArrowsOut }
const RADIUS = 108

/* The ring: up to eight quick tools in a circle, the first at the top. Click one, press its number, or Esc to leave.
   It is drawn on the desk (⌘ + middle-click) and in its own small window over other apps (Hyper R). Solid discs: it
   sits over other content. */
export function Ring({ items, onPick, onClose }) {
  const places = ringPositions(items.length, RADIUS)

  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      const item = items[Number(event.key) - 1]
      if (item) { event.preventDefault(); event.stopPropagation(); onPick(item) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [items, onPick, onClose])

  return (
    <div className="ring" role="menu" aria-label="Quick tools">
      <button type="button" className="ring-middle" aria-label="Close the ring" title="Close  esc" onClick={onClose}><X weight="bold" /></button>
      {items.map((item, index) => {
        const Icon = ICONS[item.id] || Sparkle
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ring-item is-${item.id}`}
            style={{ '--x': `${places[index].x}px`, '--y': `${places[index].y}px`, '--i': index }}
            autoFocus={index === 0}
            onClick={() => onPick(item)}
          >
            <Icon weight="regular" aria-hidden="true" />
            <span>{item.label}</span>
            <kbd aria-hidden="true">{index + 1}</kbd>
          </button>
        )
      })}
    </div>
  )
}
