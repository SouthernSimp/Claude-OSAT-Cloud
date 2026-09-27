import { CalendarWidget } from './CalendarWidget.jsx'
import { FocusWidget } from './FocusWidget.jsx'
import { FromBeforeWidget } from './FromBeforeWidget.jsx'
import { HabitsWidget } from './HabitsWidget.jsx'
import { NextWidget } from './NextWidget.jsx'
import { NowPlayingWidget } from './NowPlayingWidget.jsx'

/* The one list of widgets. A widget is a room's resting face: its title (`.widget-title`)
   opens `room`, growing out of the widget. `blurb` is its line in the tray. Now playing
   needs the Mac app's Spotify bridge. */
export const WIDGETS = [
  { id: 'calendar', label: 'Calendar', blurb: 'Today, what’s planned, and the month', Component: CalendarWidget, room: 'Calendar' },
  { id: 'next', label: 'Next', blurb: 'Your next few steps, ticked off right here', Component: NextWidget, room: 'Journal' },
  { id: 'media', label: 'Now playing', blurb: 'What Spotify is playing', Component: NowPlayingWidget, room: 'NowPlaying' },
  { id: 'focus', label: 'Focus', blurb: 'Twenty-five quiet minutes for the next step', Component: FocusWidget, room: 'Focus' },
  { id: 'habits', label: 'Habits', blurb: 'Today’s habits, kept with a tap', Component: HabitsWidget, room: 'Habits' },
  { id: 'from-before', label: 'From before', blurb: 'An older note that fits this week', Component: FromBeforeWidget, room: 'note' },
]

export const MAX_WIDGETS = 5
export const DEFAULT_WIDGETS = ['calendar', 'next', 'media']
