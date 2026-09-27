# Phase 10: a desk that opens up, and a place underneath

All paths are relative to `/Users/nate/Desktop/OSAT Field copy/`. Start the phase from `main` once Phase 9 has merged, because slice 1 moves code that Phase 9 is still changing.

**The rule for the phase:** every new power either replaces something already on screen or appears only when asked for. After Phase 10 the resting desk shows *less* than it does today:
- the greeting and one line (no verb switch, no status chip)
- a column of up to five widgets with a faint **+** under it
- the Desktop / OSAT side, unchanged
- a dock where Under takes Capture's slot

**No schema bump anywhere in the phase.**

## What checking the code changed

1. **Draft storage.** The calm proposal wanted to keep the line's draft in localStorage. That isn't needed: `hideDesk()` only hides the window and the `visit` effect never clears `draft`, so the draft already survives putting the desk away.
2. **Grow animation.** The Mac-craft proposal animated left/top/width/height. That fights `.popout`'s `min-width: 360px; min-height: 260px` (`overlay.css:19`) and its ResizeObserver, which writes every size back into state (`Desk.jsx` PopOut). A transform avoids both. Pop-outs are solid now, so no glass rule is at risk.
3. **Terminal pause.** The never-attempted proposal paused shells with SIGSTOP on the pty's process group. An interactive zsh puts each foreground job in its own process group, so a running `curl` would carry on. Cut.
4. **Files while under.** The Mac-craft proposal left Quick Look, thumbnails and Spotlight on while under. CLAUDE.md says `~/Desktop` is iCloud-synced on Nate's Mac, so thumbnailing or reading an evicted file makes macOS download it for OSAT. Under refuses `files:*`.
5. **Keys.** ⌘↓ / ⌘↑ are text navigation inside the line's textarea. Under uses ⇧⌘U.
6. **The Sky pop-out.** The calm proposal would have made Map "Board only" with the Sky living Under. Then "See in the Sky" would quietly close browser tabs and pause the model download. The Map's Sky pop-out stays, and gets a "Go under" button.
7. **Fetch guard coverage (confirmed).** Wrapping `globalThis.fetch` at the top of `main.cjs` covers all three main-process callers:
   - `download.cjs` uses the default parameter `fetchImpl = fetch`, which is resolved at call time.
   - `local-ai.cjs` calls a bare `fetch`.
   - `media.cjs` captures `fetch` in `createMedia()`, which runs inside `registerDesk()` after `whenReady`.
8. **Also confirmed in the code:**
   - The CSP's `connect-src 'self' ws:` allows websockets to any host.
   - No session has an `onBeforeRequest` listener yet (Electron allows one per session).
   - The `handle()` and `handleApp()` wrappers are single choke points for every IPC call.
   - `movable()` already tells a click from a drag.
   - The Inbox room can't be reached (`ALIASES.Inbox = 'Notes'`, and nothing calls `navigate('Inbox')`).
   - `normalizeNote` drops unknown fields, so any new note field would need a schema bump. This plan adds none.

---

## 1. One line (the centre box does everything)

**Nate:** "change the center box to a toggleable section where like you can search or take a note or idk do whatever"

**What he sees**
- **At rest:** the greeting and one line, with the placeholder *"Write it down, find it, or ask…"*. The verb switch and the chip are gone.
- **As he types,** a drawer folds open under the line (200 ms). Its rows, in order:
  1. **Save as a thought ↵**. This row is always first and highlighted, so Return never guesses.
  2. **Ask the AI on this Mac ⌘↵**, or "Set up the AI" (opens Settings → AI) when no model is ready.
  3. **Add to Next ⌥↵**
  4. Up to five matches: notes, files on this Mac (Spotlight), folders, boards, rooms and actions ("Add a widget", "Focus for 25 minutes", "Go under").
- **Keys:** ↑/↓ move through all the rows, and ↵ runs the highlighted one. Shift-↵ is a new line, as now.
- **Empty line:** ⌘K or ↓ shows "Jump to": the four latest notes and the five spaces.
- **⌘K anywhere** focuses the line, selects its text and opens the drawer. If a room covers the line, Phase 9's `raised` already lifts it. **⇧⌘N** focuses the line too.
- **Answers:** Ask's answer card takes the drawer's place, as today.

**Esc**, one step at a time, on the desk:
1. a highlighted match goes back to row 1
2. the drawer closes (the text is kept)
3. the answer card is put away
4. the top pop-out closes
5. the desk is put away

**Build**
- `src/field/Line.jsx` (new):
  - the textarea, drawer, answer card and `askHere`, moved out of `FieldDesk.jsx`
  - "type anywhere lands in the line" moves here too; its existing `[inert]` check keeps a hidden line quiet
  - the Spotlight lookup moves here from the palette (180 ms, 2 or more characters)
- `src/lib/find.js` (new, pure): `findAll(workspace, query, { files, under })` returns plain rows `{ key, label, hint, kind, go: [view, detail] }`. These are the result builders lifted out of `CommandPalette.jsx`.
- `Desk.jsx`:
  - ⌘K, the menu's `search` action and `navigate('Capture')` focus the line
  - the palette and the capture dialog are deleted
- `main.cjs`: the menu items keep their accelerators; only what they send changes.

**Data:** none. The draft is React state, which already survives hiding.

**Tests**
- `tests/find.test.mjs`: words and `#tags`, folders, boards, rooms, action synonyms, files passed in, at most 5, and notes only when `under`.
- `tests/ui/smoke.mjs` replaces its ⌘K palette flow: type → drawer → ↵ saves; ↓↵ opens a note; Esc steps.
- The e2e test's `#home-line` fill keeps working.

**Slice 1**

---

## 2. Widgets open up where they sit

**Nate:** "if I click the calendar or media player … it should occupy more of the screen"

**What he sees**
- He clicks a widget anywhere except its own controls (step rings and play keep their jobs). A press that moves 5 px or more is still a drag, as now.
- The widget's title is a real button, so this works from the keyboard too.
- The widget swells into its room over 320 ms, starting from its exact rectangle.
- The room lands on the widget's side of the line. If that side is too narrow, it takes the middle and the line rises (the Phase 9 rule).
- The widget's own spot stays empty while it is open, so it reads as the same thing, bigger.
- **Getting out:** Esc or × shrinks it back into the widget (240 ms), even if the widget has been moved. If the widget is gone, it simply closes. It drags and resizes like any other pop-out.
- The dock passes its button's rectangle too, so rooms grow out of the dock the same way. That is one line in `Dock`.

**Build**
- `Desk.jsx` gains `open(view, detail, { from, widget })`.
- `PopOut`:
  - On mount, it plays a Web Animations transform (`translate + scale`, transform-origin 0 0) from `from` to its final box. The body keeps its final size, so there is no reflow and the ResizeObserver doesn't fire.
  - `close` sets `closing`, plays the reverse toward `[data-widget="id"]`, then removes the pop-out.
  - With reduced motion there is no travel.
- The widget gets `data-open` (`visibility: hidden`) while its room is open.
- `placement.js`: `placeRoom(…, { prefer: 'left' | 'right' })` tries the preferred side first when it fits.

**Data:** the pop-out's own short-lived state, not saved.

**Tests**
- `placement.test.mjs`: the preferred side wins when it fits, and the middle is used when it doesn't.
- Smoke: click Calendar → a Calendar pop-out exists; Esc → gone.

**Slice 2**

## 3. The widget set, and adding and removing

**The rule:** a widget is a room's resting face. There are six kinds and at most five on the desk. The defaults are Calendar, Next and Now playing.

| Widget | At rest | Opened |
|---|---|---|
| **Calendar** (Day and Month merged) | Weekday, big date, next two events, mini month with busy dots | Calendar room on today |
| **Next** | Up to 5 steps with rings; "Bring N from earlier days"; in the evening its foot is "Close the day" (moved from under the line) | Today's page |
| **Now playing** | Cover, title, play/skip | New **Now playing** room: large cover, a position bar you can drag (native `<input type=range>`), prev/play/next, and **Note it on today's page** (`appendToDay` adds "♪ Title — Artist") |
| **Focus** | "25 quiet minutes" and the first open step; while running, a thin ring fills (no ticking seconds) | The existing full-screen `FocusEnvironment` |
| **Habits** | Today's habits as chips; tap to keep (`toggleHabit`) | Habits room |
| **From before** | One older note (30 days or more) that relates to this week's writing: its title and one line, plus **Not now** | That note as a pop-out |

**Left out on purpose:** weather, news and stocks (they need the network), a clock (the Mac has one), and any count.

**Adding**
- A faint **+** sits under the widget column, visible whenever fewer than five widgets are out.
- Clicking it raises a small glass tray from the **+**. It is not a modal, so the desk stays live.
- The tray shows the widgets not on the desk as live previews at real size, each with one line of description. Clicking one adds it to the foot of the column.
- The tray's foot holds **Put everything back where it was** (moved from Tools).
- Esc closes the tray. ⌘K also offers "Add a widget".
- At five, the **+** hides.

**Removing:** hovering a widget, or focusing it, shows a small **–** at its top-left corner, like the Mac's own widgets. Clicking it removes the widget at once with the Undo toast ("Habits taken off · Undo").

**Build**
- `src/field/widgets/*.jsx` holds one file per widget; the four existing widgets are moved as they are in slice 1.
- `src/field/widgets/index.js` is the one list (`id, label, blurb, Component, room`).
- `src/field/Widgets.jsx` holds the column, the **+**, the tray and the removal. It uses `useUndoToast`.
- `src/views/NowPlaying.jsx`:
  - It checks position every second only while visible; the widget stays at every 2.5 s.
  - `ROOMS.NowPlaying` and a `HIDDEN` entry in `spaces.js` let ⌘K find it.
- `media.cjs`:
  - `NOW_PLAYING` also returns `player position` and `duration of t`.
  - `seek(seconds)` accepts only a finite number between 0 and the duration, then runs `set player position to N`. It is exposed as `media:seek`.
- `field-model.js`: `pickSurfacing(notes, today, rested)` chooses among active, non-day notes created 30 or more days ago that aren't resting. It scores them with `relatedNotes` against the text of this week's notes, and falls back to a pick hashed from the date, so the choice is stable for the day.

**Data**
- Which widgets are out, and their order, go in **prefs.json** as `widgets`, per Mac (like `places`), because the layout depends on the display.
  - `desk.cjs` gets `pickWidgets(list)`, which checks shape only: at most 5 unique ids matching `/^[a-z-]{1,24}$/`. The renderer ignores ids it doesn't know, so there is no second list in main.
  - The list is returned in `desk:prefs` and set through `desk:widgets` / `osatDesk.setWidgets`.
  - When the pref is missing, the defaults apply.
  - The renderer reads `places['widget:calendar'] ?? places['widget:day']`, so Nate's old spot carries over.
- "Not now" goes in `workspace.settings.surfacing = { [noteId]: 'YYYY-MM-DD' }`. Entries older than 30 days are pruned on write. `settings` is already free-form (like blur), so there is no schema bump.

**Tests**
- `desk.test.mjs`: `pickWidgets`
- `media.test.mjs`: the new fields, and `seek` rejecting non-numbers and out-of-range values
- `field-model.test.mjs`: `pickSurfacing` (old and related wins, resting notes skipped, day notes skipped, stable within a day)
- Smoke: add Habits from the tray, remove it, press Undo.

**Slice 2**

## 4. The Desktop / OSAT switch

It stays exactly as it is, still saved in localStorage `osat.home.shelf`. It gets one connection: with the OSAT side showing, notes related to what he is typing glow (idea A). Under, the whole right side rises away with the rest of the desk.

---

## 5. Under (Nate's "Incognito")

**The name:** buttons say **Go under** and **Come up**, and the pill says *"Under · offline · nothing leaves OSAT"*. In browsers, "incognito" means nothing is saved; here everything is still saved. ⌘K finds it by *under*, *incognito*, *offline* or *private*. Nate can overrule the name with a one-word change.

**Ways in**
- the dock's **Under** button (Capture's old slot)
- **⇧⌘U** (Go menu → Go Under)
- ⌘K
- a **Go under** button in the Map's Sky tools
- the menu-bar menu

There is no confirmation: coming up restores everything.

**The descent** (about 900 ms; with reduced motion, a 150 ms fade of the ink only)
1. The page asks main (`osatUnder.set(true)`). Main switches the guard on, closes browser tabs and pauses what the table below lists, saves `prefs.under`, and only then answers. If that fails, nothing moves and one calm line says why.
2. The surface lifts away: widgets, line, right side and dock rise off the top together. This is one transform on `.home`, 450 ms, ease-in. Transform is safe on glass. `FieldDesk` stays mounted but `inert`.
3. A deep ink (`--under-*` tokens) rises from the bottom with a thin bright waterline. It is its own element, never a parent of glass, so it may fade.
4. The Sky's existing intro plays (close on the brightest star, then it pulls back). The newest star twinkles once.
5. Last, the pill appears at the top with **Come up**.

**Down there**
- **The Sky fills the screen.** `FieldSky` in a `full` mode: no search box, no count, no zoom buttons (wheel and pinch still zoom).
- **The same line sits at the bottom:** Save, Ask and Add to Next. Matches are notes only; Spotlight isn't used.
- **Typing lights the matching stars** (idea A).
- **Notes written here** are saved with `source: 'Under'` (an existing field) and glow a warmer colour.
- **Opening things:** double-clicking a star opens its note as a pop-out. The answer card's "Keep talking" opens the Ask room.
- **Nothing else:** no dock, widgets, files, browser, terminal, launchers or media.
- **Rooms open above wait above.** `Desk.jsx` stashes `pops` on the way down and puts them back on the way up. Under, `navigate` accepts only `note` and `Assistant`.

**Esc**, one step at a time, under:
1. drawer
2. selected star (`FieldSky`'s Esc gets `preventDefault` when it had a selection)
3. an earlier time goes back to now (idea B)
4. the top pop-out closes
5. the desk is put away, *still under*

**Esc never brings him up**, because coming back online should be deliberate: **Come up**, ⇧⌘U or the menu-bar menu. ⌥Space brings back the Sky, with `Under.jsx` focusing its line on `desk:shown`. A relaunch stays under.

**The menu-bar icon** swaps to a moon template (`trayUnderTemplate.png` and `@2x`), and the menu's first item reads "Under · Come up". That way the state shows even with the desk hidden.

**Coming up** (about 600 ms): the descent plays in reverse. Main switches the guard off, reopens the tabs, and resumes the download and the iPhone link. The desk bumps `visit` so the Desktop icons refresh. One line shows for a few seconds: *"Back up. Nothing left OSAT while you were under."*

### What "no internet" means for each path

| Path in the code | Under |
|---|---|
| Desk and quick chat (default session, `file://`) | `webRequest.onBeforeRequest` cancels everything except `file:`, `data:`, `blob:`, `about:`, `devtools:` and loopback. The CSP `ws:` becomes `ws://127.0.0.1:* ws://localhost:*`. |
| Browser tabs (`persist:osat-browser`) | `browser.cjs` gets `sleep()`, which closes every tab and returns its URL, and `wake(urls)`, which reopens them. `browser:open`/`navigate` answer "The web waits above." The same webRequest guard on that session is a second lock, and also covers service workers. |
| Links out (`setWindowOpenHandler` → `openExternal`, main.cjs:479) | Refused. |
| Main-process `fetch` (model download, Spotify covers, LM Studio) | `globalThis.fetch` is wrapped once at the top of `main.cjs`. Under, only loopback passes. |
| Model download (`ai/`) | Main calls `ai.cancel()` (the `.part` file stays, state `paused`) and remembers it was running; coming up calls `ai.resume()`. Under, `ai:resume` and `ai:choose` (for a tier not yet downloaded) answer "Downloads wait until you come up." At launch under, `ai.start()` waits until he comes up. |
| Built-in engine (`utilityProcess`, `getLlama({ build: 'never' })`, local file) | Works. |
| LM Studio at 127.0.0.1:1234 | **Allowed**: loopback never leaves the Mac. Said plainly on the page. |
| iCloud (`phone.cjs` inbox and copy, `sync.cjs`) | `stopPhone()` on the way down, and `startPhone()` on the way up if `prefs.phone`. It is never `disable`, which would delete the copy. Sync keeps noting changes, as it already does while the link is off. `phone:enable` is refused, and the launch-time `startPhone` is skipped while under. |
| Spotify (AppleScript) | `media:*` refused: Spotify streams from the internet when told to play. |
| Files, Quick Look, thumbnails, Spotlight, opening files, launchers | `files:*` and `desk:launch` refused (the Desktop is iCloud-backed). |
| Terminal (node-pty) | `terminal:start` refused. Shells already running are Nate's own programs and are left alone; the pill's detail says "A terminal you started is still running." |
| macOS and other apps | Not OSAT's to stop; one line in the pill's detail says so. |

**Enforcement**
- `desktop/under.cjs` (new) holds:
  - `isLocal(url)` (pure)
  - `guardFetch(fetch, isUnder)`, which rejects with an `OfflineError`
  - `createUnder({ prefs, save })`
- `main.cjs` sets things up in this order:
  1. At the very top: the fetch wrap, and `app.on('session-created', installGuard)`, which covers the default session and the browser's partition.
  2. Right after `loadPrefs()`: `under.on = prefs.under`, before the AI, the iPhone link or any window starts.
- One refusal check goes in `handle()` and `handleApp()`: `if (under.on && REFUSED_UNDER.test(channel)) fail(line)`. This covers `browser:open|navigate`, `files:*`, `media:*`, `desk:launch`, `terminal:start`, `ai:resume|choose` and `phone:enable`.
- IPC `under:set` and `under:status` are accepted from the desk only; `under:changed` is broadcast to every window. The page only asks; main decides.

**What's still saved:** everything, as always: `workspace.json` and its 14 snapshots in Application Support, which is not in iCloud. Only the leaving pauses.

**In the browser preview:** Under is the look only (there's no main process), and the pill says "Preview".

**Tests**
- `tests/under.test.mjs`:
  - an `isLocal` table
  - `guardFetch` passes local addresses and, only while under, rejects the rest
  - a **fence scan** of `desktop/**/*.cjs` that fails on `require('(node:)?(http|https|http2|net|tls|dgram|undici)')`, `net.request`/`net.fetch`, `new WebSocket` or `openExternal` outside a short allowlist, so any new network path must be added on purpose
- e2e test (no internet needed):
  - under closes browser tabs, and `browser:open` is refused
  - the desk's `fetch('https://example.com')` fails with the webRequest cancel
  - `ai:resume` answers "waits"
  - coming up reopens the tabs
  - a relaunch with `prefs.under` starts under
- Smoke: an "under" screenshot.

**Slice 3**

---

## 6. Three original ideas (kept)

### A. Notes light up as you write (about half a session)
This is the "connections" Nate asked for.

**What he sees**
- After a 250 ms pause in typing, up to five related notes light up: OSAT-side icons glow on the desk, and stars brighten while the rest dim under.
- While an answer shows, the notes the AI read stay lit (`answer.noteIds`, which already exist).
- After ↵, a chip "Link to *Title*" stays for 6 s. One click adds `[[Title]]` to the new note, so the Sky draws a real line. Nothing links by itself.

**Build**
- `Line.jsx` computes `lit = relatedNotes(notes, draft, 5)` and reports it through `onLit`.
- `FieldDesk` reuses the existing `.is-linked` glow.
- `FieldSky` gets a `lit` prop: a star not in `lit` dims when `lit` isn't empty.
- The chip calls `updateNote`.

**Data:** nothing new.

**Tests:** smoke (a title word lights that icon, and lights that star under).

**Honest:** Smart Connections lists related notes in a sidebar. Lighting them up in your own spatial map as you type is the new part.

### B. The Sky remembers (about half a session, Under only)

**What he sees**
- A hairline along the bottom edge is time, a native `<input type=range>` running from the first note to now.
- Dragging it left fades out the stars written after that day and their lines, and shows the date. Positions never move, because stars are hidden, not laid out again.
- A small **Now** appears at the right end whenever he isn't at now; Esc also returns to now.

**Build:** `buildSkyGraph` nodes gain `createdAt`; `FieldSky` gets an `until` prop; `Under.jsx` holds the slider.

**Data:** none.

**Tests:** `field-model.test.mjs` asserts `createdAt` on nodes; smoke drags the slider and fewer stars show.

**Limit:** the Sky's 180-star cap stays, because the physics is O(n²).

**Honest:** Obsidian plugins do graph timelapses; scrubbing your own history inside an offline place is new-ish.

### C. Receipts: what left this Mac (about half a session, once the guard exists)

**What he sees:** Settings → Data gets a section, "What left this Mac", covering the last 7 days:
- "huggingface.co · the AI model · Tue"
- "i.scdn.co · album covers · 41 times"
- "127.0.0.1 · LM Studio (stays on this Mac)"
- "The Browser · pages you opened yourself" (a count only: no sites are listed, so no history is kept)
- A fixed line when the iPhone link is on: "iCloud Drive · your notes are copied there"
- Days spent under read "Nothing: you were under."

It is a page you visit, never a notification.

**Build**
- `under.cjs` `record(url, kind)` counts allowed requests per day and host, with a small map from host to purpose. It is fed by `guardFetch` and by the webRequest listener.
- The log is kept in `userData/ledger.json` (per Mac, never synced), holds 30 days, and is written at most once a minute.
- IPC `app:ledger`, and a short list in `Settings.jsx`.

**Tests:** `under.test.mjs` covers counting, pruning, and browser hosts never being stored.

**Honest:** Apple's App Privacy Report does this for a whole iPhone. No Mac notes app shows its own.

---

## 7. Removed or merged

**Merged into the line**
- the capture dialog and the dock's **Capture** button (⇧⌘N focuses the line; the dock slot becomes **Under**)
- the ⌘K palette (`CommandPalette.jsx` is deleted; its logic moves to `src/lib/find.js`)
- the four-verb switch and the always-on chip, which become drawer rows
- the AI status text, which becomes row 2

**Shown only when saving fails** (calm rule 7): the "Saved privately on this Mac" chip and the dock's status dot.

**Moved**
- Day and Month widgets → **Calendar**.
- "Close the day" pill under the line → the Next widget's evening foot.
- Tools → "Focus for 25 minutes" → the Focus widget and ⌘K.
- Tools → "Put widgets and icons back" → the tray's foot.
- The roadmap's old Phase 10 (floating windows) → Later.

**Deleted**
- the Sky's "N thoughts" count (calm rule 3)
- the **Inbox room**, which nothing can reach: `views/Inbox.jsx`, `ROOMS.Inbox`, its `case`, its CSS selectors and the alias

**Kept on purpose:** the Desktop / OSAT switch, Map's Board / Sky switch, Browser, Terminal, and the quick chat.

**Cut from the three proposals**

| Cut | Why |
|---|---|
| Porthole widget | A second live `FieldSky` on the desk would steal ←/→/Enter/`/` through its window listeners, and it duplicates the dock's door to Under |
| Two-finger scroll to sink | Too easy to trigger by accident |
| First-time explainer card | Everything is reversible |
| Arrange mode with Done | A mode to learn; the tray and the – button do the job |
| Native `app:menu` context menus | Not needed for this |
| Shuffle, repeat and volume in Now playing | Spotify already has them |
| Only one widget open at a time; click the empty desk to close | Not needed |
| Notes that "stay under" (`deep`) | Schema bump, and partial records in sync |
| Sleep on it | Schema bump |
| The moment / where you came from | Automation prompts, timing risk, schema |
| Let go (Archive renamed, deep stars) | A good follow-up |
| Ask a constellation | Not needed yet |
| 400 stars | Physics cost |
| localStorage draft | Already free, see above |

**Noticed, not in this phase:** right-clicking a dock app removes it with no Undo. Fixing it safely needs main to remember the removed path.

---

## 8. Build slices

Slice 1 lands first. Slices 2 and 3 then run in parallel; slice 4 comes last. They land as commits or stacked PRs on the one phase branch. If stacked: **retarget the upper PR to main before deleting the lower branch.**

| Slice | Owns (only this slice edits these) | Shared files: the only region it touches |
|---|---|---|
| **1. One line** (about 1 session) | New `src/field/Line.jsx`, `src/lib/find.js`, `tests/find.test.mjs`; move `DayWidget`, `MonthWidget`, Next and `MediaWidget` unchanged into `src/field/widgets/`; delete `src/views/CommandPalette.jsx` and `src/views/Inbox.jsx`; `tests/ui/smoke.mjs` (⌘K flow) | `FieldDesk.jsx` (shrinks to layout); `Desk.jsx` (key handler, `onCommand`, `navigate('Capture')`, palette, dialog and Inbox removed); `Shell.jsx` (Capture button out, status dot only on error, Focus item out); `spaces.js` (Inbox alias); `main.cjs` (two menu items); `home.css`, `components.css`, `views.css` |
| **2. Widgets** (about 1.5 sessions) | `src/field/widgets/*` (Calendar merge, Focus, Habits, FromBefore, `index.js`), `src/field/Widgets.jsx`, `src/views/NowPlaying.jsx`, `desktop/media.cjs` and its test, `desktop/desk.cjs` and its test, `src/shell/placement.js` and its test, `field.css`, `overlay.css` (grow) | `FieldDesk.jsx` (renders `<Widgets>`); `Desk.jsx` (`open`, `close`, `PopOut`, `ROOMS`, `PopRoom`, widget prefs); `main.cjs` (inside `registerDesk` only); `preload.cjs` (`osatDesk` only); `field-model.js` (add `pickSurfacing`) and its test; `spaces.js` (`HIDDEN` NowPlaying); `Shell.jsx` (tidy item out) |
| **3. Under** (about 2 sessions) | New `desktop/under.cjs`, `tests/under.test.mjs`, `src/shell/Under.jsx`, `src/styles/under.css`, `desktop/assets/trayUnder*`; `desktop/browser.cjs`; `index.html` (CSP); the Under block in `tests/e2e/electron.mjs` | `main.cjs` (top-of-file guard, one new "Under" section, the check in `handle`/`handleApp`, the `openExternal` check, startup order, tray, one Go-menu item); `preload.cjs` (new `osatUnder` only); `tokens.css` (`--under-*`); `FieldSky.jsx` (`full`, count removed, Esc `preventDefault`); `Desk.jsx` (surface swap, pops stash, navigate allowlist, ⇧⌘U, Esc under); `Shell.jsx` (Under button) |
| **4. Connections** (about 1 session, after 1 and 3) | Ledger in `under.cjs` and its test; `Settings.jsx` (Data section); `docs/ROADMAP.md` and `CLAUDE.md` (no other slice edits these) | `Line.jsx` (`lit`, link chip); `FieldDesk.jsx` (icon glow); `FieldSky.jsx` (`lit`, `until`); `Under.jsx` (time hairline); `field-model.js` (`createdAt` on nodes) and its test; `main.cjs` (`app:ledger` in the Under section); `preload.cjs` (`osatApp.ledger`) |

**Mac checklist per slice**
1. ⌘K over a room raises the line; the Esc order.
2. The grow motion on the real screen; five widgets fit; Spotify seek.
3. Checks on going under and coming up:
   - the desktop vanishes on the way down, in light and dark
   - the menu-bar moon icon shows
   - tabs close and come back
   - the download says it is waiting
   - the iPhone link pauses
   - ⌥Space while under shows the Sky
   - quitting and reopening stays under
4. The glow while typing, the time slider, and the receipts page.

The whole phase is about 5–6 focused sessions.

---

## 9. For Nate, in 30 seconds

**The middle box does everything now.** Type, and it offers to save the thought, ask the AI, or add it to Next, and shows your notes and files that match. ⌘K and ⇧⌘N just jump into it.

**Widgets open up.** Click the calendar or the music player and it grows into a bigger view right from where it sits; Esc shrinks it back. A small **+** under the widgets adds more: Focus, Habits and "From before", which brings back an older note that fits what you're writing. Day and Month are now one calendar widget.

**Under takes OSAT offline.** The new Under button makes the desk rise away, and you drop into your sky of notes. Nothing leaves OSAT down there (no web, no downloads, no iCloud) until you choose to come up; your tabs come back when you do.

**Things light up.** As you type, related notes light up. Under, you can drag back through time and watch your sky grow. Settings shows exactly what OSAT ever sent off your Mac.

**About the name:** I called it "Under" rather than "Incognito", because in browsers incognito means nothing gets saved, and here everything is still saved. Say the word and it's Incognito.

## 10. Risks

- **Phase 9 isn't merged yet.** Slice 1 rewrites the same line code, so it must branch from `main` after Phase 9 merges.
- **Return always saves.** If Nate types to search and presses Return, he gets a thought instead. ↓ reaches the matches. If this bites during his try, add an Undo toast on save; don't make Return guess.
- **The grow scales the room's content** for 320 ms, the way the Mac's own window zoom does. Pop-outs are solid, so a `clip-path` reveal is a safe fallback if it looks cheap.
- **Under's promise is "OSAT itself."** A terminal Nate already started keeps running, other apps (including LM Studio) have their own connections, and macOS itself isn't stopped. The pill says this in one line. `fetch` follows redirects on its own, so a loopback server that redirects outward isn't re-checked; only LM Studio lives there.
- **Esc doesn't bring him up.** That is deliberate, but it's new. The pill always shows **Come up**, and the menu-bar icon shows the state.
- **Five widgets on a small screen.** Check the 1440×900 screenshot with five out. If they don't fit, lower the cap to four.
- **The Sky's 180-star cap** limits how far back time goes on large workspaces. Paging comes when Nate passes that.
- **The moon icon** needs a 16/32 px template PNG drawn from the MoonStars icon. If that's fiddly, the menu's "Under · Come up" line alone still tells him.