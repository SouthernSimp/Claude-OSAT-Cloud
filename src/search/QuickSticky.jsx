import { useEffect, useRef, useState } from 'react'
import { Crop, ListBullets, ListNumbers, Monitor, TextB, TextItalic, X } from '@phosphor-icons/react'

import { pictureLine } from '../../shared/capture-model.mjs'
import { Picture } from '../lib/Picture.jsx'
import { listFromTyping, toMarkdown } from './rich-text.js'

/* The quick sticky (Hyper N): write with lists and bold, add the whole screen or an area you drag, ⌘Return saves it to
   Unsorted. What is being written is kept on this Mac until it is saved (a bar put away by accident loses nothing). */
const DRAFT = 'osat.quick-sticky.v1'
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT)) || {} } catch { return {} } }
const keepDraft = (draft) => { try { localStorage.setItem(DRAFT, JSON.stringify(draft)) } catch { /* private window */ } }
const dropDraft = () => { try { localStorage.removeItem(DRAFT) } catch { /* private window */ } }

// Apple Notes' keys for lists: ⇧⌘7 bullets, ⇧⌘9 numbers.
const LIST_KEYS = { Digit7: 'insertUnorderedList', Digit9: 'insertOrderedList' }

export function QuickSticky({ bridge, onSave, onBack, said }) {
  const field = useRef(null)
  const [pictures, setPictures] = useState(() => readDraft().pictures || [])
  const [busy, setBusy] = useState(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const element = field.current
    if (!element) return
    element.innerHTML = readDraft().html || ''
    setEmpty(!element.textContent.trim())
    element.focus()
    // The caret at the end of what was there.
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
  }, [])

  const remember = (next = pictures) => keepDraft({ html: field.current?.innerHTML || '', pictures: next })
  const run = (command) => { field.current?.focus(); document.execCommand(command); remember() }

  async function addPicture(area) {
    if (!bridge?.stickyPicture || busy) return
    remember()
    setBusy(true)
    try {
      const got = await bridge.stickyPicture(area)
      if (got?.ok) { const next = [...pictures, got.name]; setPictures(next); remember(next) }
      else if (got?.reason === 'mac') said('Screenshots work in the Mac app.')
    } finally {
      setBusy(false)
      field.current?.focus()
    }
  }

  function save() {
    const words = toMarkdown(field.current)
    if (!words && !pictures.length) { said('Nothing to save', 1200); return }
    const markdown = [words || 'Screenshot', ...pictures.map(pictureLine)].join('\n')
    dropDraft()
    onSave(markdown)
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); remember(); onBack(); return }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); save(); return }
    if (event.metaKey && event.shiftKey && LIST_KEYS[event.code]) { event.preventDefault(); run(LIST_KEYS[event.code]) }
  }

  // "- " or "1. " at the start of a line becomes a list, as in Notes.
  function onInput() {
    const selection = getSelection()
    const node = selection?.anchorNode
    if (node?.nodeType === 3 && selection.anchorOffset <= 3) {
      const command = listFromTyping(node.textContent.slice(0, selection.anchorOffset))
      const inList = node.parentElement?.closest('li')
      if (command && !inList) {
        // The "- " goes the editor's own way (so the caret stays put), then the line becomes a list.
        const marker = document.createRange()
        marker.setStart(node, 0)
        marker.setEnd(node, selection.anchorOffset)
        selection.removeAllRanges()
        selection.addRange(marker)
        document.execCommand('delete')
        document.execCommand(command)
      }
    }
    setEmpty(!field.current?.textContent.trim())
    remember()
  }

  return (
    <div className="quick-sticky" onKeyDown={onKeyDown}>
      <div
        ref={field}
        className={`quick-sticky-field${empty ? ' is-empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Write a sticky"
        data-placeholder="Write a sticky… “- ” starts a list"
        onInput={onInput}
        onPaste={(event) => {
          // Words only: a paste from a web page brings its words, not its styles.
          event.preventDefault()
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
        }}
      />
      {pictures.length > 0 && (
        <div className="quick-sticky-pictures">
          {pictures.map((name) => (
            <figure key={name}>
              <Picture name={name} width={320} />
              <button type="button" aria-label="Take this screenshot off" title="Take it off" onClick={() => { const next = pictures.filter((item) => item !== name); setPictures(next); remember(next) }}><X weight="bold" /></button>
            </figure>
          ))}
        </div>
      )}
      <div className="quick-sticky-bar">
        <div className="quick-sticky-tools" role="toolbar" aria-label="Format">
          <button type="button" title="Bullets (⇧⌘7)" aria-label="Bullets" onMouseDown={(event) => event.preventDefault()} onClick={() => run('insertUnorderedList')}><ListBullets /></button>
          <button type="button" title="Numbers (⇧⌘9)" aria-label="Numbers" onMouseDown={(event) => event.preventDefault()} onClick={() => run('insertOrderedList')}><ListNumbers /></button>
          <button type="button" title="Bold (⌘B)" aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => run('bold')}><TextB /></button>
          <button type="button" title="Italic (⌘I)" aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => run('italic')}><TextItalic /></button>
          <span className="quick-sticky-sep" aria-hidden="true" />
          <button type="button" title="Add the whole screen" aria-label="Add the whole screen" disabled={busy} onClick={() => addPicture(false)}><Monitor /> Screen</button>
          <button type="button" title="Add a part of the screen" aria-label="Add a part of the screen" disabled={busy} onClick={() => addPicture(true)}><Crop /> Area</button>
        </div>
        <button type="button" className="quick-sticky-save" onClick={save}>Save to Just in <kbd>⌘↵</kbd></button>
      </div>
    </div>
  )
}
