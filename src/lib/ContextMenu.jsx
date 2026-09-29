import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CaretLeft, CaretRight, Check } from '@phosphor-icons/react'

/* Right-click menus: solid, at the pointer, always on screen. Items are like Menu.jsx's
   ({ label, icon, hint, onSelect, danger, disabled, checked, divider }), plus `items` (a
   list to step into, with a way back) and `swatches` ({ swatches: ['canary', …], picked,
   onPick }: paper colours in a row).
     const [menu, openMenu] = useContextMenu()
     <div onContextMenu={(event) => openMenu(event, items)}>…</div> {menu} */
export function useContextMenu() {
  const [state, setState] = useState(null)
  const open = useCallback((event, items) => {
    event.preventDefault()
    event.stopPropagation()
    const list = items.filter(Boolean)
    if (list.length) setState({ x: event.clientX, y: event.clientY, stack: [list], at: Date.now() })
  }, [])
  const element = state && (
    <ContextMenu
      key={state.at}
      {...state}
      onClose={() => setState(null)}
      onStep={(items) => setState((value) => ({ ...value, stack: [...value.stack, items.filter(Boolean)] }))}
      onBack={() => setState((value) => ({ ...value, stack: value.stack.slice(0, -1) }))}
    />
  )
  return [element, open]
}

function ContextMenu({ x, y, stack, onClose, onStep, onBack }) {
  const node = useRef(null)
  const items = stack.at(-1)
  const [spot, setSpot] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const box = node.current.getBoundingClientRect()
    setSpot({
      left: Math.max(8, Math.min(x, innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, innerHeight - box.height - 8)),
    })
    node.current.querySelector('button:not(:disabled)')?.focus()
  }, [x, y, stack.length])

  useEffect(() => {
    document.documentElement.dataset.menu = 'open'
    const outside = (event) => { if (!node.current?.contains(event.target)) onClose() }
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (stack.length > 1) onBack()
        else onClose()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const buttons = [...node.current.querySelectorAll('button:not(:disabled)')]
      const at = buttons.indexOf(document.activeElement)
      buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
    }
    addEventListener('pointerdown', outside, true)
    addEventListener('keydown', key, true)
    addEventListener('blur', onClose)
    return () => {
      delete document.documentElement.dataset.menu
      removeEventListener('pointerdown', outside, true)
      removeEventListener('keydown', key, true)
      removeEventListener('blur', onClose)
    }
  }, [stack.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={node} className="context-menu" role="menu" style={spot} onContextMenu={(event) => event.preventDefault()}>
      {stack.length > 1 && (
        <button type="button" role="menuitem" className="context-back" onClick={onBack}><CaretLeft /> <span>Back</span></button>
      )}
      {items.map((item, index) => {
        if (item.divider) return <hr key={`d${index}`} />
        if (item.swatches) {
          return (
            <div key={`s${index}`} className="context-swatches" role="group" aria-label={item.label || 'Colour'}>
              {item.swatches.map((paper) => (
                <button
                  key={paper}
                  type="button"
                  role="menuitemradio"
                  aria-checked={item.picked === paper}
                  aria-label={paper}
                  data-paper={paper}
                  onClick={() => { onClose(); item.onPick(paper) }}
                />
              ))}
            </div>
          )
        }
        if (item.note) return <p key={`n${index}`} className="context-note">{item.note}</p>
        return (
          <button
            key={`${item.label}${index}`}
            type="button"
            role="menuitem"
            className={`${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.items) { onStep(item.items); return }
              onClose()
              item.onSelect?.()
            }}
          >
            {item.checked ? <Check weight="bold" /> : item.icon ? <item.icon /> : <i />}
            <span>{item.label}</span>
            {item.hint && <small>{item.hint}</small>}
            {item.items && <CaretRight className="context-more" />}
          </button>
        )
      })}
    </div>
  )
}
