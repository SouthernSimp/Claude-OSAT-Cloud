import { useEffect, useState } from 'react'

import { detailsFor } from '../../shared/quick-search-model.mjs'
import { layoutById } from '../../shared/window-layouts.mjs'
import { RowIcon } from './icons.jsx'

const COPIED_WORDS = new Set(['text', 'link', 'email', 'phone', 'number'])

/* The big preview beside the results: the file (the words of a text file, or the page Quick Look draws),
   the copied picture or text, the app's icon, the note; and, under it, the details: where, what kind, how
   big; for a copy, which app it came from and when. Whatever is loading shows what the list already knew. */
export function Preview({ row, bridge, workspace, offer = null, now, onDragStart }) {
  const [loaded, setLoaded] = useState({ key: null })
  useEffect(() => {
    if (!row || !bridge) return undefined
    let live = true
    const done = (patch) => { if (live) setLoaded({ key: row.key, ...patch }) }
    const d = row.data
    if (row.kind === 'file') bridge.preview(d.rootId, d.relative).then(done, () => done({}))
    else if (row.kind === 'image') bridge.clipboardImage(d.id).then((image) => done({ image }), () => done({}))
    else if (COPIED_WORDS.has(row.kind)) bridge.clipboardText(d.id).then((text) => done({ text }), () => done({}))
    else if (row.kind === 'app') bridge.appIcon(d.path).then((thumb) => done({ thumb }), () => done({}))
    else if (row.kind === 'shot') bridge.captureThumb(d.id).then((thumb) => done({ thumb }), () => done({}))
    return () => { live = false }
  }, [row?.key, bridge]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return <section className="qs-preview is-empty" aria-label="Preview"><p>Nothing to show yet.</p></section>
  const d = row.data
  const own = loaded.key === row.key ? loaded : {}
  const details = detailsFor(row, { now })

  let body
  if (row.kind === 'file' && own.text) body = <pre className="qs-text">{own.text}</pre>
  else if (row.kind === 'file' && own.thumb) body = <img className="qs-picture" src={own.thumb} alt="" draggable={false} />
  else if (row.kind === 'image') body = <img className="qs-picture" src={own.image || d.thumb} alt="A copied picture" draggable={false} />
  else if (row.kind === 'shot' && own.thumb) body = <img className="qs-picture" src={own.thumb} alt="" draggable={false} />
  else if (row.kind === 'app' && own.thumb) body = <img className="qs-app-icon" src={own.thumb} alt="" draggable={false} />
  else if (row.kind === 'calc') body = <p className="qs-big">{row.title}</p>
  else if (row.kind === 'layout') body = <LayoutPreview id={d.layout} />
  else if (COPIED_WORDS.has(row.kind)) body = <pre className={`qs-text ${row.kind === 'link' ? 'is-link' : ''}`}>{own.text ?? d.text}</pre>
  // Save as a sticky / Ask the AI: the words that would go.
  else if (row.kind === 'sticky' || row.kind === 'ask') body = <pre className="qs-text">{d.text}</pre>
  else if (row.kind === 'note') body = <NotePreview workspace={workspace} id={d.go?.[1]?.noteId} />
  else if (row.kind === 'node') body = <NodePreview workspace={workspace} id={d.go?.[1]?.folderId} />
  else body = <div className="qs-glyph"><RowIcon row={row} weight="light" /></div>

  return (
    <section className="qs-preview" aria-label="Preview">
      {/* A copy or a capture drags out from here too (`onDragStart` starts the Mac's own drag). */}
      <div className="qs-stage" data-kind={row.kind} draggable={Boolean(onDragStart)} onDragStart={onDragStart}>{body}</div>
      <footer className="qs-facts">
        <h2>{row.kind === 'calc' ? row.subtitle : row.title}</h2>
        {details.length > 0 && (
          <dl className="qs-details">
            {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        )}
        {offer && <p className="qs-offer">This looks like {offer.folderName}’s. <kbd>⇧⌘N</kbd> adds it to {offer.folderName}.</p>}
      </footer>
    </section>
  )
}

/* A screen, and the part of it the window will take. */
function LayoutPreview({ id }) {
  const box = layoutById(id)?.box
  return (
    <div className="qs-screen" aria-hidden="true">
      <i className={box ? '' : id === 'next-display' ? 'is-next' : 'is-back'} style={box ? { left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` } : undefined} />
    </div>
  )
}

function NotePreview({ workspace, id }) {
  const note = workspace?.notes.find((item) => item.id === id)
  if (!note) return <div className="qs-glyph"><RowIcon row={{ kind: 'note' }} weight="light" /></div>
  return <pre className="qs-text">{note.markdown.slice(0, 1200)}</pre>
}

function NodePreview({ workspace, id }) {
  const stickies = (workspace?.notes || []).filter((note) => note.folderId === id && !note.trashedAt).slice(0, 8)
  if (!stickies.length) return <div className="qs-glyph"><RowIcon row={{ kind: 'node' }} weight="light" /></div>
  return <ul className="qs-stickies">{stickies.map((note) => <li key={note.id}>{note.title}</li>)}</ul>
}
