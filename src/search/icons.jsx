import { useEffect, useState } from 'react'
import {
  AppWindow, Calculator, Clipboard, EnvelopeSimple, File, FileAudio, FileDoc, FileImage, FilePdf, FileText, FileVideo, FileXls, FileZip,
  FolderSimple, Globe, Hash, Image, Layout, Link, NotePencil, Phone, Sparkle, TreeStructure,
  Aperture, ClockCounterClockwise, Monitor, Record, Scroll, Selection, TextAa,
} from '@phosphor-icons/react'

/* Screenshots and recording (shared/capture-model.mjs), on the ring and in the quick search. */
export const CAPTURE_ICONS = { area: Selection, window: AppWindow, fullscreen: Monitor, scrolling: Scroll, 'all-in-one': Aperture, record: Record, text: TextAa, history: ClockCounterClockwise }

/* One small picture for each kind of row; a file's is drawn from its name. */
const FILE_ICONS = [
  [/\.pdf$/i, FilePdf], [/\.(jpe?g|png|heic|heif|gif|tiff?|webp|bmp|svg)$/i, FileImage], [/\.(mov|mp4|m4v|avi|mkv)$/i, FileVideo],
  [/\.(mp3|m4a|wav|aiff?|flac|aac)$/i, FileAudio], [/\.(docx?|pages|rtf|odt)$/i, FileDoc], [/\.(xlsx?|csv|numbers|tsv)$/i, FileXls],
  [/\.(zip|rar|7z|tar|gz|tgz|dmg)$/i, FileZip], [/\.(txt|md|markdown|log|json|xml|ya?ml|html?|css|jsx?|tsx?|py|sh)$/i, FileText],
]
const BY_KIND = {
  folder: FolderSimple, text: Clipboard, link: Link, email: EnvelopeSimple, phone: Phone, number: Hash, image: Image, app: AppWindow,
  note: NotePencil, sticky: NotePencil, ask: Sparkle, node: TreeStructure, room: Sparkle, calc: Calculator, 'keyword-app': AppWindow, 'keyword-link': Globe, layout: Layout,
}

export function RowIcon({ row, weight = 'regular' }) {
  if (row.kind === 'file') {
    const Icon = FILE_ICONS.find(([pattern]) => pattern.test(row.title))?.[1] || File
    return <Icon weight={weight} aria-hidden="true" />
  }
  if (row.kind === 'shot') { const Shot = /\.(mp4|mov|gif)$/i.test(row.title) ? FileVideo : FileImage; return <Shot weight={weight} aria-hidden="true" /> }
  const Icon = (row.kind === 'capture' && CAPTURE_ICONS[row.data?.capture]) || BY_KIND[row.kind] || Sparkle
  return <Icon weight={weight} aria-hidden="true" />
}

/* An app's own icon (from Quick Look), kept for the next time; its name's glyph while it loads. */
const icons = new Map()
export function AppIcon({ bridge, row }) {
  const path = row.data.path
  const [src, setSrc] = useState(() => icons.get(path) || null)
  useEffect(() => {
    if (!bridge || icons.has(path)) { setSrc(icons.get(path) || null); return undefined }
    let live = true
    bridge.appIcon(path).then((value) => { if (icons.size > 300) icons.clear(); icons.set(path, value || ''); if (live) setSrc(value || null) }, () => {})
    return () => { live = false }
  }, [bridge, path])
  return src ? <img className="qs-row-icon" src={src} alt="" draggable={false} /> : <RowIcon row={row} />
}
