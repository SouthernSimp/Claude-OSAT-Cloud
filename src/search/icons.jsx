import { useEffect, useState } from 'react'
import { spaceFor } from '../lib/spaces.js'
import { pageById } from '../views/settings/pages.js'
import {
  AppWindow, Calculator, Clipboard, EnvelopeSimple, File, FileAudio, FileDoc, FileImage, FilePdf, FileText, FileVideo, FileXls, FileZip,
  ArrowRight, FolderSimple, Power, TextAlignLeft, Globe, Hash, Image, Layout, Link, NotePencil, Phone, Sparkle, TreeStructure,
  Aperture, ClockCounterClockwise, Keyboard, Monitor, Record, Scroll, Selection, TextAa, Timer, SquaresFour, Compass, WifiSlash, PencilSimpleLine,
  WifiHigh, Bluetooth, ShieldCheck, Bell, SpeakerHigh, Moon, Hourglass, GearSix, Info, ArrowsClockwise, HardDrives, ListChecks, CircleHalf,
  PersonArmsSpread, SlidersHorizontal, Waveform, MagnifyingGlass, HandPalm, BatteryFull, LockKey, Fingerprint, Users, At, Mouse, Cursor,
  Printer, ShareNetwork, Clock, Translate, AppleLogo, Lock, SpeakerSlash, EyeSlash, Trash, Smiley,
} from '@phosphor-icons/react'

/* Screenshots and recording (shared/capture-model.mjs), on the ring and in the quick search. */
export const CAPTURE_ICONS = { area: Selection, window: AppWindow, fullscreen: Monitor, scrolling: Scroll, 'all-in-one': Aperture, record: Record, text: TextAa, history: ClockCounterClockwise, 'from-clipboard': Clipboard }

/* One small picture for each kind of row; a file's is drawn from its name. */
const FILE_ICONS = [
  [/\.pdf$/i, FilePdf], [/\.(jpe?g|png|heic|heif|gif|tiff?|webp|bmp|svg)$/i, FileImage], [/\.(mov|mp4|m4v|avi|mkv)$/i, FileVideo],
  [/\.(mp3|m4a|wav|aiff?|flac|aac)$/i, FileAudio], [/\.(docx?|pages|rtf|odt)$/i, FileDoc], [/\.(xlsx?|csv|numbers|tsv)$/i, FileXls],
  [/\.(zip|rar|7z|tar|gz|tgz|dmg)$/i, FileZip], [/\.(txt|md|markdown|log|json|xml|ya?ml|html?|css|jsx?|tsx?|py|sh)$/i, FileText],
]
const BY_KIND = {
  folder: FolderSimple, text: Clipboard, link: Link, email: EnvelopeSimple, phone: Phone, number: Hash, image: Image, app: AppWindow,
  note: NotePencil, sticky: NotePencil, ask: Sparkle, node: TreeStructure, room: Sparkle, calc: Calculator, 'keyword-app': AppWindow, 'keyword-link': Globe, layout: Layout, more: ArrowRight, snippet: TextAlignLeft, system: Power, menu: Keyboard, emoji: Smiley,
}

/* The quick bar draws each row's glyph on a small coloured tile, like an app's icon (Raycast-style): one hue per kind. */
const TINTS = {
  ask: 'violet', room: 'indigo', note: 'yellow', sticky: 'yellow', node: 'teal', calc: 'graphite', layout: 'blue', capture: 'pink', shot: 'pink',
  snippet: 'green', 'keyword-link': 'blue', 'keyword-app': 'indigo', system: 'red', menu: 'graphite', folder: 'sky', file: 'slate', emoji: 'orange',
  text: 'slate', link: 'blue', email: 'sky', phone: 'green', number: 'graphite', image: 'pink',
}
export const tintOf = (row) => TINTS[row.kind] || null

/* What a row is, in one grey word on its right (Raycast's "Application", "Command"). */
const TYPES = {
  app: 'Application', process: 'Application', room: 'OSAT', note: 'Note', sticky: 'Sticky', node: 'Board', calc: 'Calculator', layout: 'Window',
  capture: 'Screenshot', shot: 'Capture', snippet: 'Snippet', 'keyword-link': 'Quick link', 'keyword-app': 'Command', system: 'Command', menu: 'Menu',
  folder: 'Folder', file: 'File', emoji: 'Emoji', text: 'Clipboard', link: 'Clipboard', email: 'Clipboard', phone: 'Clipboard', number: 'Clipboard', image: 'Clipboard',
}
export const typeOf = (row) => TYPES[row.kind] || ''

/* OSAT's own rooms and commands wear their room's tile (spaces.js) or their Settings page's; a few actions their own. */
const ACTION_LOOKS = {
  Capture: [PencilSimpleLine, 'yellow'], Clipboard: [Clipboard, 'sky'], Focus: [Timer, 'red'], Widgets: [SquaresFour, 'blue'],
  Tour: [Compass, 'teal'], Offline: [WifiSlash, 'graphite'], Assistant: [Sparkle, 'violet'],
}
/* The Mac's own commands and System Settings' panes, drawn the way System Settings draws them. */
const SYSTEM_LOOKS = {
  lock: [Lock, 'graphite'], sleep: [Moon, 'indigo'], 'screen-off': [Monitor, 'graphite'], 'dark-mode': [CircleHalf, 'graphite'],
  mute: [SpeakerSlash, 'pink'], 'hide-others': [EyeSlash, 'graphite'], 'empty-bin': [Trash, 'red'],
  'Wi-Fi': [WifiHigh, 'blue'], Bluetooth: [Bluetooth, 'blue'], Network: [Globe, 'blue'], VPN: [ShieldCheck, 'blue'], Notifications: [Bell, 'red'],
  Sound: [SpeakerHigh, 'pink'], Focus: [Moon, 'indigo'], 'Screen Time': [Hourglass, 'indigo'], General: [GearSix, 'graphite'],
  'About this Mac': [Info, 'graphite'], 'Software Update': [ArrowsClockwise, 'graphite'], Storage: [HardDrives, 'graphite'],
  'Login Items': [ListChecks, 'graphite'], Appearance: [CircleHalf, 'graphite'], Accessibility: [PersonArmsSpread, 'blue'],
  'Control Center': [SlidersHorizontal, 'graphite'], Siri: [Waveform, 'violet'], Spotlight: [MagnifyingGlass, 'graphite'],
  'Privacy & Security': [HandPalm, 'blue'], 'Desktop & Dock': [AppWindow, 'graphite'], Displays: [Monitor, 'blue'], Wallpaper: [Image, 'teal'],
  Battery: [BatteryFull, 'green'], 'Lock Screen': [LockKey, 'graphite'], 'Touch ID & Password': [Fingerprint, 'red'], 'Users & Groups': [Users, 'blue'],
  'Internet Accounts': [At, 'blue'], Keyboard: [Keyboard, 'graphite'], Mouse: [Mouse, 'graphite'], Trackpad: [Cursor, 'graphite'],
  'Printers & Scanners': [Printer, 'graphite'], Sharing: [ShareNetwork, 'graphite'], 'Date & Time': [Clock, 'blue'], 'Language & Region': [Translate, 'blue'],
  'Time Machine': [ClockCounterClockwise, 'green'], 'Apple Account': [AppleLogo, 'graphite'],
}
export function lookOf(row) {
  if (row.kind === 'system') {
    const id = row.data?.id || ''
    const look = SYSTEM_LOOKS[id.startsWith('pane:') ? row.title : id]
    return look ? { Icon: look[0], tint: look[1] } : null
  }
  if (row.kind !== 'room') return null
  const key = String(row.key || '')
  if (key.startsWith('settings:')) { const page = pageById(key.slice(9)); if (page) return { Icon: page.icon, tint: page.tint } }
  const view = row.data?.go?.[0]
  if (key.startsWith('act:') && ACTION_LOOKS[view]) return { Icon: ACTION_LOOKS[view][0], tint: ACTION_LOOKS[view][1] }
  const space = view && spaceFor(view)
  return space ? { Icon: space.icon, tint: space.tint || 'indigo' } : null
}

/* A row's icon as the bar shows it: the glyph on its tile, or the bare glyph for rows without one ("See all"). */
export function RowTile({ row, className = 'qs-tile' }) {
  const look = lookOf(row)
  if (look) return <span className={`tile ${className}`} data-tint={look.tint} aria-hidden="true"><look.Icon weight="fill" /></span>
  const tint = tintOf(row)
  if (!tint) return <RowIcon row={row} />
  return <span className={`tile ${className}`} data-tint={tint} aria-hidden="true"><RowIcon row={row} weight="fill" /></span>
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
  return src ? <img className="qs-row-icon" src={src} alt="" draggable={false} /> : <RowTile row={{ ...row, kind: 'keyword-app' }} />
}
