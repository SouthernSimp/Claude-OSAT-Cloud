import { useEffect, useState } from 'react'
import { ClipboardText, FileText } from '@phosphor-icons/react'

/* The copies and files an answer read, under it like the note chips (UsedNotes). A copied item opens to show its words
   (read from the clipboard history now, so a copy that has since been cleared says "No longer saved"); a file opens in
   Files, or says "No longer there". Asking changes nothing: these only show. */

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const day = (at) => (Number.isNaN(Date.parse(at)) ? 'copy' : DAY.format(new Date(at)))
const bridge = () => (typeof window === 'undefined' ? null : window.osatSearch)

export function UsedSources({ copies, files, navigate, className = 'bubble-notes' }) {
  const [words, setWords] = useState({}) // copy id → its words, or null when it is gone
  const [shown, setShown] = useState(null)
  const [missing, setMissing] = useState({}) // file key → true
  const key = (copies || []).map((copy) => copy.id).join('|')
  useEffect(() => {
    let live = true
    for (const copy of copies || []) {
      Promise.resolve(bridge()?.clipboardText?.(copy.id)).then((text) => live && setWords((now) => ({ ...now, [copy.id]: text ?? null })), () => live && setWords((now) => ({ ...now, [copy.id]: null })))
    }
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!copies?.length && !files?.length) return null

  async function openFile(file) {
    const where = `${file.rootId}\0${file.relative}`
    try { await bridge()?.preview?.(file.rootId, file.relative) } catch { setMissing((now) => ({ ...now, [where]: true })); return }
    navigate?.('Files', { rootId: file.rootId, relative: file.relative.split('/').slice(0, -1).join('/'), select: file.relative })
  }

  return (
    <>
      <p className={className}>
        <span>Also from</span>
        {(copies || []).map((copy) => (words[copy.id] === null
          ? <span key={copy.id} className="bubble-gone">No longer saved</span>
          : <button key={copy.id} type="button" title="Something you copied · click to see it" aria-expanded={shown === copy.id} onClick={() => setShown(shown === copy.id ? null : copy.id)}>
            <ClipboardText /> <em>Copied</em> {day(copy.at)}
          </button>))}
        {(files || []).map((file) => (missing[`${file.rootId}\0${file.relative}`]
          ? <span key={`${file.rootId}${file.relative}`} className="bubble-gone">No longer there</span>
          : <button key={`${file.rootId}${file.relative}`} type="button" title="A file · opens in Files" onClick={() => openFile(file)}>
            <FileText /> <em>File</em> {file.name}
          </button>))}
      </p>
      {shown && words[shown] && <blockquote className="bubble-copy">{words[shown].slice(0, 1200)}{words[shown].length > 1200 ? '…' : ''}</blockquote>}
    </>
  )
}
