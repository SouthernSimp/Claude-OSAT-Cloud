import { useMemo, useState } from 'react'
import { ArrowLeft, X } from '@phosphor-icons/react'
import { folderPath, searchNotes } from '../notes-model.js'
import { Markdown } from '../lib/markdown.jsx'
import { reviewSuggestions } from './sort-review.js'

const PAGE = 20
export function UnsortedSorter({ workspace, notes, actions, history, notice, onBack, onClose }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [preview, setPreview] = useState(notes[0]?.id)
  const [destination, setDestination] = useState('')
  const [placeQuery, setPlaceQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const found = useMemo(() => searchNotes(notes, query), [notes, query])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(found.length / PAGE) - 1))
  const shown = found.slice(currentPage * PAGE, (currentPage + 1) * PAGE)
  const waiting = new Set(notes.map((note) => note.id))
  const picked = [...selected].filter((id) => waiting.has(id))
  const note = shown.find((item) => item.id === preview) || shown[0]
  const places = workspace.folders.map((folder) => ({ ...folder, path: folderPath(workspace.folders, folder.id).join(' / ') }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const available = places.filter((place) => place.path.toLowerCase().includes(placeQuery.toLowerCase()) || place.id === destination)
  const suggestions = useMemo(() => reviewSuggestions(workspace, shown), [workspace, query, currentPage])
  function toggle(id) { setSelected((value) => { const next = new Set(value); next.has(id) ? next.delete(id) : next.add(id); return next }) }
  function move(event) {
    event.preventDefault()
    actions.fileUnsorted(picked, creating ? null : destination, creating ? newName : '')
    setSelected(new Set())
    setNewName('')
    setCreating(false)
  }
  return <aside className="sky-unsorted-drawer is-sorting" aria-label="Sort Unsorted stickies" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onBack() } }}>
    <header><div><h2>Make room for your thoughts <span>{notes.length} waiting</span></h2><p>Read a small batch. Choose a home. Keep the rest for later.</p></div><button type="button" aria-label="Close Unsorted" onClick={onClose}><X /></button></header>
    <div className="sort-review-toolbar"><button type="button" onClick={onBack}><ArrowLeft /> Back to stickies</button><label className="sky-drawer-search"><input aria-label="Search sorting queue" placeholder="Search thoughts or #tags" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); setSelected(new Set()) }} /></label></div>
    <div className="sort-review-body">
      <section className="sort-review-queue" aria-label="Sticky review queue">
        <div className="sort-review-selection"><span>{found.length ? `${currentPage * PAGE + 1}–${Math.min((currentPage + 1) * PAGE, found.length)} of ${found.length}` : 'No matches'}</span><button type="button" disabled={!shown.length} onClick={() => setSelected(new Set([...selected, ...shown.map((item) => item.id)]))}>Select this batch</button><button type="button" disabled={!picked.length} onClick={() => setSelected(new Set())}>Clear</button></div>
        <div className="sort-review-list">{shown.map((item) => <div key={item.id} className="sort-review-row" data-current={note?.id === item.id || undefined}><input type="checkbox" aria-label={`Select ${item.title}`} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /><button type="button" aria-label={`Read ${item.title}`} onClick={() => setPreview(item.id)}><strong>{item.title || 'Untitled'}</strong><span>{item.markdown.slice(0, 140)}</span></button></div>)}{!shown.length && <p>{query ? 'No thoughts match. Try another search.' : 'All clear. New thoughts can wait here.'}</p>}</div>
        <nav aria-label="Sorting batches"><button type="button" disabled={!currentPage} onClick={() => { setPage(currentPage - 1); setSelected(new Set()) }}>Previous batch</button><button type="button" disabled={(currentPage + 1) * PAGE >= found.length} onClick={() => { setPage(currentPage + 1); setSelected(new Set()) }}>Next batch</button></nav>
      </section>
      <section className="sort-review-detail" aria-label="Read and file stickies">
        {note && <article className="sort-review-preview"><div><h3>{note.title}</h3><button type="button" onClick={() => actions.openNote(note.id)}>Open in Notes</button></div><Markdown text={note.markdown} /></article>}
        <form className="sort-review-file" onSubmit={move}><strong>{picked.length} selected</strong><p>Select thoughts, then choose where they belong.</p><div className="sort-review-mode"><button type="button" aria-pressed={!creating} onClick={() => setCreating(false)}>Existing topic or branch</button><button type="button" aria-pressed={creating} onClick={() => setCreating(true)}>New topic</button></div>
          {creating ? <label>Topic name<input aria-label="New sorting topic name" maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} /></label> : <><input aria-label="Find a sorting destination" placeholder="Find a topic or branch" value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} /><select aria-label="Move selected stickies to" value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Choose a home…</option>{available.map((place) => <option key={place.id} value={place.id}>{place.path}</option>)}</select>{!places.length && <p>Create your first topic to give these thoughts a home.</p>}</>}
          <button type="submit" className="is-primary" disabled={!picked.length || (creating ? !newName.trim() : !workspace.folders.some((folder) => folder.id === destination))}>{creating ? 'Create topic and move' : 'Move selected'}{picked.length ? ` · ${picked.length}` : ''}</button>
        </form>
        {suggestions.length > 0 && <section className="sort-review-suggestions" aria-label="Suggested groups"><h3>Possible groups in this batch</h3><p>Matched tags and words, on this device. Review before moving.</p>{suggestions.slice(0, 6).map((group) => <button type="button" key={group.key} onClick={() => { setSelected(new Set(group.noteIds)); setPreview(group.noteIds[0]); setCreating(group.kind === 'make'); setNewName(group.name || ''); setDestination(group.folderId || '') }}>Review {group.noteIds.length} for {group.name || places.find((place) => place.id === group.folderId)?.path}</button>)}</section>}
      </section>
    </div>
    <footer><span role="status">{notice || 'Moves keep your original notes. You can undo them during this Sky session.'}</span><button type="button" disabled={!history.length} onClick={actions.undoUnsorted}>Undo last move{history.length ? ` · ${history.length}` : ''}</button></footer>
  </aside>
}
