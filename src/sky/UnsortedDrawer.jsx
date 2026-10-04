import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, MagnifyingGlass, X } from '@phosphor-icons/react'
import { searchNotes } from '../notes-model.js'
import { UnsortedSorter } from './UnsortedSorter.jsx'
import { StickyList } from './Piles.jsx'

export function UnsortedDrawer({ workspace, notes, actions, target, history, notice, onClose }) {
  const [sorting, setSorting] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(24)
  const root = useRef(null)
  const found = useMemo(() => searchNotes(notes, query), [notes, query])
  const shown = target && !query ? found : found.slice(0, limit)
  useEffect(() => {
    if (!target) return
    const sticky = [...(root.current?.querySelectorAll('[data-note]') || [])].find((element) => element.dataset.note === target)
    sticky?.scrollIntoView({ block: 'center' })
    sticky?.focus({ preventScroll: true })
  }, [target])
  if (sorting) return <UnsortedSorter workspace={workspace} notes={notes} actions={actions} history={history} notice={notice} onBack={() => setSorting(false)} onClose={onClose} />
  return <aside ref={root} className="sky-unsorted-drawer" aria-label="Unsorted stickies" onKeyDown={(event) => { if (event.key === 'Escape' && !event.target.matches('textarea')) { event.stopPropagation(); onClose() } }}>
    <header><div><h2>Unsorted <span>{notes.length}</span></h2><p>Give these a home when you’re ready.</p></div><button type="button" aria-label="Close Unsorted" onClick={onClose}><X /></button></header>
    <label className="sky-drawer-search"><MagnifyingGlass /><input aria-label="Search Unsorted" placeholder="Find a thought, #tag" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(24) }} /></label>
    <div className="sky-drawer-scroll"><StickyList id="sky:unsorted" folderId={null} notes={shown} actions={actions} empty={query ? 'No thoughts match this search.' : 'All clear. New captures can wait here.'} />{shown.length < found.length && <button type="button" className="sky-drawer-more" onClick={() => setLimit((value) => value + 24)}>Show more · {found.length - shown.length} remaining</button>}</div>
    <footer><button type="button" className="is-primary" onClick={() => setSorting(true)}>Sort stickies in batches</button><span>Drag a sticky onto a topic, or use its menu.</span><button type="button" onClick={() => actions.openUnsortedNotes()}>Open in Notes <ArrowUpRight /></button></footer>
  </aside>
}
