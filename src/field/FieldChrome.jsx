import { useEffect, useState } from 'react'
import {
  BookOpenText,
  CalendarBlank,
  CaretDown,
  CurrencyDollar,
  DotsThree,
  Files,
  Globe,
  TerminalWindow,
  FolderSimple,
  GearSix,
  HourglassMedium,
  House,
  Image,
  ListChecks,
  MagnifyingGlass,
  Moon,
  MoonStars,
  NotePencil,
  Plus,
  ShareNetwork,
  Sparkle,
  Sun,
  Tray,
  UploadSimple,
} from '@phosphor-icons/react'

import { Menu } from '../lib/Menu.jsx'

const TABS = [
  ['Today', 'Today'],
  ['Notes', 'Notes'],
  ['Mindmap', 'Mindmap'],
  ['Journal', 'Journal'],
  ['Calendar', 'Calendar'],
  ['Assistant', 'Local AI'],
]

const MORE = [
  ['Browser', 'Browser', Globe],
  ['Terminal', 'Terminal', TerminalWindow],
  ['Sky', 'Sky', MoonStars],
  ['Projects', 'Projects', FolderSimple],
  ['Habits', 'Habits', ListChecks],
  ['Reflection', 'Reflect', BookOpenText],
  ['Budget', 'Money', CurrencyDollar],
  ['Files', 'Files', Files],
  ['Inbox', 'Inbox', Tray],
  ['Obsidian', 'Obsidian', UploadSimple],
  ['Settings', 'Settings', GearSix],
]

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/* One bar for every view. The active tab's pill carries a view-transition
   name, so navigating glides it to the next tab instead of blinking. */
export function FieldTopbar({ view, navigate, storage, onCommands, onCapture, onTheme }) {
  const extra = MORE.find(([id]) => id === view)
  const pill = <span className="topbar-pill" aria-hidden="true" />
  return (
    <header className="topbar">
      <div className="topbar-start">
        <button type="button" className="wordmark" onClick={() => navigate('Today')}>OSAT</button>
        <span className={`topbar-saved ${storage.status}`} title={storage.message}>
          <i />
          {storage.status === 'error' ? 'Check storage' : 'On this Mac'}
        </span>
      </div>
      <nav className="topbar-tabs" aria-label="Workspace">
        {TABS.map(([id, label], index) => (
          <button key={id} type="button" title={`${label}  ⌘${index + 1}`} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}>
            {view === id && pill}
            <span>{label}</span>
          </button>
        ))}
        <Menu
          align="end"
          className="topbar-more"
          ariaLabel="More spaces"
          items={MORE.map(([id, label, icon]) => ({ label, icon, checked: view === id, onSelect: () => navigate(id) }))}
          trigger={({ toggle, open }) => (
            <button type="button" aria-haspopup="menu" aria-expanded={open} aria-current={extra ? 'page' : undefined} onClick={toggle}>
              {extra && pill}
              <span>{extra ? extra[1] : 'More'}</span>
              <CaretDown weight="bold" />
            </button>
          )}
        />
      </nav>
      <div className="topbar-end">
        <button type="button" className="topbar-search" onClick={onCommands}>
          <MagnifyingGlass />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <button type="button" className="topbar-icon topbar-new" aria-label="New thought" title="New thought (N)" onClick={onCapture}>
          <Plus weight="bold" />
        </button>
        <button type="button" className="topbar-icon" aria-label="Switch light or dark appearance" onClick={onTheme}>
          <Sun className="sun-icon" />
          <Moon className="moon-icon" />
        </button>
      </div>
    </header>
  )
}

/* The dock lives on home only. Rooms keep the top bar, so nothing ever sits
   over the Local AI composer, the Mindmap controls or the Notes editor. */
const DOCK_ROOMS = [
  ['Today', 'Today', House],
  ['Notes', 'Notes', NotePencil],
  ['Mindmap', 'Mindmap', ShareNetwork],
  ['Journal', 'Journal', BookOpenText],
  ['Calendar', 'Calendar', CalendarBlank],
  ['Assistant', 'Local AI', Sparkle],
]
const DOCK_PLACES = [
  ['Browser', 'Browser', Globe],
  ['Terminal', 'Terminal', TerminalWindow],
  ['Sky', 'Sky', MoonStars],
  ['Files', 'Files', Files],
]
const WALLPAPERS = [['lake', 'Lake at blue hour'], ['moss', 'Fern and moss']]

export function HomeDock({ navigate, storage, aiReady, onSearch, onCapture, onTheme, onFocus, wallpaper, onWallpaper }) {
  const button = (key, label, Icon, onClick, tip = label, extra = {}) => (
    <button key={key} type="button" aria-label={label} data-tip={tip} onClick={onClick} {...extra}>
      <Icon />
    </button>
  )
  return (
    <nav className="glass dock" aria-label="Rooms">
      <div className="dock-group">
        {DOCK_ROOMS.map(([id, label, Icon], index) => button(id, label, Icon, () => navigate(id), `${label}  ⌘${index + 1}`, {
          'aria-current': id === 'Today' ? 'page' : undefined,
          className: id === 'Today' || (id === 'Assistant' && aiReady) ? 'is-running' : undefined,
        }))}
      </div>
      <i className="dock-rule" />
      <div className="dock-group">
        {DOCK_PLACES.map(([id, label, Icon]) => button(id, label, Icon, () => navigate(id)))}
        {button('focus', 'Focus, twenty-five quiet minutes', HourglassMedium, onFocus, 'Focus')}
        <Menu
          align="start"
          className="dock-more"
          ariaLabel="More spaces"
          items={[
            ...MORE.filter(([id]) => !['Browser', 'Terminal', 'Sky', 'Files'].includes(id)).map(([id, label, icon]) => ({ label, icon, onSelect: () => navigate(id) })),
            { divider: true },
            ...WALLPAPERS.map(([id, label]) => ({ label, icon: Image, checked: wallpaper === id, onSelect: () => onWallpaper(id) })),
          ]}
          trigger={({ toggle, open }) => (
            <button type="button" aria-label="More spaces" data-tip="More" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
              <DotsThree weight="bold" />
            </button>
          )}
        />
      </div>
      <i className="dock-rule" />
      <div className="dock-group">
        {button('search', 'Search', MagnifyingGlass, onSearch, 'Search  ⌘K')}
        {button('new', 'New thought', Plus, onCapture, 'New thought')}
        <button type="button" aria-label="Switch light or dark appearance" data-tip="Light or dark" onClick={onTheme}>
          <Sun className="sun-icon" />
          <Moon className="moon-icon" />
        </button>
        <span className={`dock-status ${storage?.status || ''}`} role="status" data-tip={storage?.status === 'error' ? 'Check storage' : 'Saved on this Mac'} title={storage?.message}>
          <i />
          <span className="visually-hidden">{storage?.status === 'error' ? `Check storage. ${storage.message || ''}` : 'Saved on this Mac'}</span>
        </span>
      </div>
    </nav>
  )
}

export function FieldBanner({ preview, sampled, onKeep, onBlank, onRemove }) {
  if (preview) {
    return (
      <div className="field-banner" role="status">
        <p>A sample room, so you can see the shape of it. Nothing is saved yet.</p>
        <button type="button" className="primary-button" onClick={onKeep}>Keep this room</button>
        <button type="button" onClick={onBlank}>Start blank</button>
      </div>
    )
  }
  if (!sampled) return null
  return (
    <div className="field-banner field-banner-quiet">
      <p>Sample notes are mixed in with yours.</p>
      <button type="button" onClick={onRemove}>Remove the samples</button>
    </div>
  )
}
