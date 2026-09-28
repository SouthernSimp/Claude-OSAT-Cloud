import { useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, Minus, Plus } from '@phosphor-icons/react'

import { useUndoToast } from '../lib/UndoToast.jsx'
import { grow } from '../shell/placement.js'
import { DEFAULT_WIDGETS, MAX_WIDGETS, WIDGETS } from './widgets/index.js'

/* The widget column on the left of the desk: up to five of the widgets in widgets/index.js,
   in Nate's order (`list`, per Mac; null means the defaults). Clicking a widget anywhere but
   its own controls opens its room, growing out of it; the widget's spot stays empty while
   the room is open (`openIds`). A faint + under the column raises the tray of widgets not
   out yet; hovering a widget shows a – that takes it off at once, with Undo. `tray` is ⌘K's
   "Add a widget". `props` go to every widget. */
export function Widgets({ list, onList, openIds, tray: summoned = 0, places, move, hasPlaces, onTidy, props }) {
  const [toast, showUndo] = useUndoToast()
  const [tray, setTray] = useState(false)
  const [fresh, setFresh] = useState(null)
  const add = useRef(null)
  const available = WIDGETS.filter((widget) => widget.id !== 'media' || props.media)
  const out = (list ?? DEFAULT_WIDGETS).map((id) => available.find((widget) => widget.id === id)).filter(Boolean).slice(0, MAX_WIDGETS)
  const ids = out.map((widget) => widget.id)

  useEffect(() => {
    if (summoned) setTray(true)
  }, [summoned])

  function remove(widget) {
    onList(ids.filter((id) => id !== widget.id))
    showUndo(`${widget.label} taken off`, () => { onList(ids); setFresh(widget.id) })
    // From the keyboard, focus goes on to the + rather than nowhere.
    window.setTimeout(() => add.current?.focus())
  }

  function closeTray(refocus) {
    setTray(false)
    if (refocus) add.current?.focus()
  }

  return (
    <>
      <aside className="home-widgets" aria-label="Today at a glance">
        {out.map((widget) => (
          <Frame
            key={widget.id}
            widget={widget}
            props={props}
            open={openIds.has(widget.id)}
            fresh={widget.id === fresh}
            onSettled={() => setFresh(null)}
            // Nate's old Day widget spot carries over to Calendar.
            move={move(`widget:${widget.id}`, widget.id === 'calendar' ? places['widget:calendar'] ?? places['widget:day'] : undefined)}
            onRemove={() => remove(widget)}
          />
        ))}
        <div className="widgets-foot">
          {out.length < MAX_WIDGETS && (
            <button ref={add} type="button" className="widgets-add" aria-label="Add a widget" title="Add a widget" aria-expanded={tray} onClick={() => setTray((value) => !value)}>
              <Plus weight="bold" />
            </button>
          )}
          {toast}
        </div>
      </aside>
      {tray && (
        <Tray
          widgets={available.filter((widget) => !ids.includes(widget.id))}
          full={out.length >= MAX_WIDGETS}
          from={add.current}
          props={props}
          onAdd={(widget) => { onList([...ids, widget.id]); setFresh(widget.id); closeTray(false) }}
          tidy={hasPlaces ? () => { onTidy(); closeTray(true) } : null}
          onClose={closeTray}
        />
      )}
    </>
  )
}

/* One widget on the desk. Its title is the button that opens its room; a click anywhere
   else that isn't one of its own controls presses that title. */
function Frame({ widget, props, open, fresh, onSettled, move, onRemove }) {
  const node = useRef(null)
  const openRoom = (view, detail = null) => props.navigate(view, detail, { from: rect(node.current), widget: widget.id })
  return (
    <section
      ref={node}
      className={`glass widget widget-${widget.id} ${fresh ? 'is-new' : ''}`}
      aria-label={widget.label}
      data-widget={widget.id}
      data-open={open || undefined}
      {...move}
      onClick={(event) => {
        if (!event.target.closest('button, a, input, label, textarea, select')) node.current.querySelector('.widget-title')?.click()
      }}
      onAnimationEnd={(event) => { if (fresh && event.target === event.currentTarget) onSettled() }}
    >
      <button type="button" className="widget-remove" aria-label={`Take ${widget.label} off the desk`} title="Take off the desk" onClick={onRemove}>
        <Minus weight="bold" />
      </button>
      <widget.Component {...props} open={openRoom} />
    </section>
  )
}

/* The tray: a small solid sheet beside the column, not a modal. Each widget not on the desk,
   live, with one line; a click adds it to the foot of the column. Esc or a click elsewhere
   puts it away. */
function Tray({ widgets, full, from, props, onAdd, tidy, onClose }) {
  const node = useRef(null)
  const done = useRef(onClose)
  done.current = onClose

  useEffect(() => {
    const element = node.current
    grow(element, from?.isConnected ? rect(from) : null)
    element.querySelector('button')?.focus()
    document.documentElement.dataset.menu = 'open'
    const outside = (event) => { if (!event.target.closest('.widgets-tray, .widgets-add')) done.current(false) }
    const key = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      done.current(true)
    }
    addEventListener('pointerdown', outside, true)
    addEventListener('keydown', key, true)
    return () => {
      delete document.documentElement.dataset.menu
      removeEventListener('pointerdown', outside, true)
      removeEventListener('keydown', key, true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={node} className="widgets-tray" role="dialog" aria-label="Add a widget">
      <p className="widgets-tray-head">{full ? 'The desk holds five widgets. Take one off with its – to add another.' : 'Add a widget'}</p>
      {/* The preview is inert (its controls are only for show), so a click on it lands here. */}
      {!full && widgets.map((widget) => (
        <div key={widget.id} className="widgets-pick" onClick={() => onAdd(widget)}>
          <div className={`widget widget-${widget.id} widget-preview`} inert>
            <widget.Component {...props} open={() => {}} />
          </div>
          <button type="button" className="widgets-pick-line" aria-label={`Add ${widget.label}: ${widget.blurb}`}><b>{widget.label}</b> {widget.blurb}</button>
        </div>
      ))}
      {!full && !widgets.length && <p className="widget-empty">Every widget is on the desk.</p>}
      {tidy && (
        <footer>
          <button type="button" onClick={tidy}><ArrowCounterClockwise /> Put everything back where it was</button>
        </footer>
      )}
    </div>
  )
}

const rect = (element) => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}
