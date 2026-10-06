import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, MagnifyingGlass, X } from '@phosphor-icons/react'
import { searchNotes } from '../notes-model.js'
import { UnsortedSorter } from './UnsortedSorter.jsx'
import { StickyList } from './Piles.jsx'

/* Unsorted in the Sky: the sorter, and "See the list", the whole pile as a list to search and
   pick a few from. `start` asks the sorter to begin somewhere ({ target, mode, at }). */
export function UnsortedDrawer({ workspace, notes, actions, history, ai, navigate, start, active, onClose }) {
  const [browsing, setBrowsing] = useState(false)
  const [picked, setPicked] = useState(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(24)
  const found = useMemo(() => searchNotes(notes, query), [notes, query])
  const shown = found.slice(0, limit)
  useEffect(() => { if (active) setBrowsing(false) }, [active, start?.at])
  const request = picked && (!start || picked.at > start.at) ? picked : start
  return <><UnsortedSorter hidden={browsing || !active} start={request} workspace={workspace} notes={notes} actions={actions} history={history} ai={ai} navigate={navigate} onBrowse={() => setBrowsing(true)} onClose={onClose} />
  {browsing && active && <aside className="sky-unsorted-drawer" aria-label="Unsorted stickies" onKeyDown={(event) => { if (event.key === 'Escape' && !event.target.matches('textarea')) { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header><div><h2>Unsorted <span>{notes.length}</span></h2><p>Give these a home when you’re ready.</p></div><button type="button" aria-label="Close Unsorted" onClick={onClose}><X /></button></header>
    <label className="sky-drawer-search"><MagnifyingGlass /><input aria-label="Search Unsorted" placeholder="Find a thought, #tag" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(24) }} /></label>
    <div className="sky-drawer-scroll"><StickyList id="sky:unsorted" folderId={null} notes={shown} actions={actions} empty={query ? 'No thoughts match this search.' : 'All clear. New captures can wait here.'} />{shown.length < found.length && <button type="button" className="sky-drawer-more" onClick={() => setLimit((value) => value + 24)}>Show more · {found.length - shown.length} remaining</button>}</div>
    <footer><button type="button" className="is-primary" disabled={!found.length} onClick={() => { setPicked({ ids: found.map((note) => note.id), chosen: Boolean(query.trim()), at: Date.now() }); setBrowsing(false) }}>{query.trim() ? `Sort these ${found.length}` : 'Sort them one at a time'}</button><button type="button" onClick={() => setBrowsing(false)}>Back to sorting</button><button type="button" onClick={() => actions.openUnsortedNotes()}>Open in Notes <ArrowUpRight /></button></footer>
  </aside>}</>
}
