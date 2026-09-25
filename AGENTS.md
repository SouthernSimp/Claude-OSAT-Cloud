# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Treat this repository as the source for the NateOS Electron application. Preserve Today, Inbox, Ideas, Projects, Canvas, Files, themes, existing local-storage keys, and the Electron file bridge when adding features. Daily Habits use explicit Build or Avoid choices and date-specific checks. Reflection has exactly three prompts, one editable entry for the current local date, and read-only prior entries. Both stay local to the app. Never add or complete a habit from a reflection without an explicit user action.

The August 31 OSAT direction supersedes the older graphite dashboard as the visible product language. Display `OSAT` only and never expand the initials. Use the McCreery.ai visual family: mineral-white and ink surfaces, one restrained cobalt accent, system-first typography, practical density, light-first system dark mode, a native pointer, and purposeful reduced-motion-safe animation. Desktop uses a sidebar; phone widths use a bottom bar with Today, Capture, Notes, and More.

Preserve `ai.mccreery.nateos`, the `NateOS` application-data directory, existing `nateos.*` local-storage keys, record IDs, and Canvas geometry as compatibility internals. New local records use the shared IndexedDB store; legacy local-storage values are imported once and retained as rollback data. Visible Canvas and Mindmap are one app-native Mindmap workspace rather than a remote or duplicated surface.

Future Obsidian-vault and `os.mccreery.ai` communication must be explicit, reviewable, idempotent, and loss-resistant. Until a real bridge is approved and verified, label each connection honestly as inactive; never scan, file, overwrite, or sync vault content silently.

## September 10 OSAT design preview

This is an independent snapshot of the editable application. The original checkout and installed OSAT application are preserved. Visible name is OSAT, never a version suffix. Local preview uses 127.0.0.1:5199.

The primary product goal is one private workspace with genuinely local AI running on the Mac, capable of a real offline demonstration. The interface should feel premium and alive, with Apple/Raycast simplicity, purposeful motion, and reduced-motion support. Notes, thinking, next steps, projects, and Mindmap should connect through shared records. Cross-device use is desired; do not imply sync, iPhone inference, or iPad inference exists before implemented and verified.

The sample workspace is added explicitly and preserves existing records. New next steps are Markdown checkboxes in canonical notes. AI only contacts the fixed loopback runtime; workspace context requires an explicit toggle; saving a response into Notes requires an explicit action. Keep the runtime boundary and unavailable states honest. Never add cloud fallback.

## September 10 rebuild (Claude)

Nate gave explicit creative freedom for this pass and asked that the earlier
visual constraints above be treated as history, not as rules. The decisions
below supersede them where they conflict.

### Layout: one scroll container, no viewport arithmetic

`.app-shell` is exactly `100dvh` and never scrolls. `.workspace-content` is the
single scroll container. Views that fill the frame (Mindmap, Local AI, Notes,
Calendar — listed in `FILLED_VIEWS` in `App.jsx`) get `.is-filled`, which makes
them `height: 100%` and gives them responsibility for their own inner scrolling.

**Never write `calc(100dvh - <number>)` again.** Every one of those was a guess
at the current chrome height, and every one broke when the chrome changed — the
Local AI composer was clipped out of the viewport entirely because of one. Use
`height: 100%` inside the shell instead.

Two related traps, both fixed and both easy to reintroduce:

- A grid track written as `1fr` means `minmax(auto, 1fr)`, so a wide child (a
  `datetime-local` input, a `<pre>`) can push the track past the viewport.
  Write `minmax(0, 1fr)`.
- A grid that declares `grid-template-rows` but no `grid-template-columns` gets
  one implicit column sized to max-content, which does the same thing. Always
  declare the columns.

### Styles

`styles.css` and `experience.css` are gone. They defined two competing `:root`
token sets plus a trailing block of font-size patches, so which value won
depended on import order. The replacement is `src/styles/`:

| file | owns |
| --- | --- |
| `tokens.css` | colour, type, space, radius, elevation, motion — the only place values are defined |
| `base.css` | reset and element defaults |
| `shell.css` | app frame, sidebar, topbar, mobile bar, scroll architecture |
| `components.css` | buttons, cards, forms, dialogs, command palette, empty states |
| `views.css` / `today.css` | per-view rules carried over from the old sheets |
| `calendar.css`, `assistant.css` | the two rebuilt views |

Legacy names (`--blue`, `--danger`, `--surface-strong`, `--shadow-sm`, …) survive
as aliases at the bottom of `tokens.css` so older rules pick up the new palette
rather than a second one. Prefer the new names in new code.

### Calendar

Month grid plus an agenda rail for the selected day. Provider links (Google,
Outlook, .ics) moved into a per-event menu instead of three links on every row.
Below 940px it drops out of grid into plain block flow and the view scrolls —
that is deliberate; fighting track sizing at that width clipped the month.

The previous version had **no CSS at all** for `.month-grid`, `.weekday-row` or
`.month-toolbar`. If the calendar ever looks like a row of squashed pills again,
check that `calendar.css` is still imported.

### Local AI

Conversations, not one thread. They live in their own IndexedDB database
(`osat-chats`), separate from the workspace, because chat history is device-local
and deliberately excluded from workspace exports. The old single-thread
`osat.local-chat.v1` key is migrated once and left in place as rollback data.

Replies stream. The Vite proxy and the Electron main process both pass LM
Studio's SSE through; `streamLocalMessage` falls back to a plain JSON response if
the runtime does not stream. `max_tokens` is 2048, up from 640.

Replies render as Markdown through `src/assistant/markdown.jsx`, which builds
React elements directly — no HTML string and no `dangerouslySetInnerHTML`, so
model output cannot inject markup.

The model may propose workspace actions in a fenced `osat-actions` block. Those
are parsed out of the visible prose, validated, capped at eight, and shown as
cards. **Nothing is applied without an explicit click**, which keeps the "no
automatic AI edits" promise intact. An unterminated block is hidden while the
reply is still streaming so raw JSON never flashes in the transcript.

The system prompt carries today's date. Without it the model guesses the year —
it scheduled a September 14th event in 2024 during testing.

Workspace context is per-conversation and opt-in: the person picks which notes
and projects to share, and only those are sent.

### Dead code removed

`MindmapView` in `App.jsx` was 1,784 lines that were never rendered — Mindmap has
used `SorterView` for some time. `App.jsx` went from 4,559 lines to ~400 and the
views now live in `src/views/`.

## September 13 — OSAT V2 (Claude)

This folder is `~/Desktop/Projects/OSAT V2`, a full copy of `OSAT Claude Copy` made on
September 13, 2026 and then redesigned around one request: build out Notes and
the Mindmap, and make organization the point. The decisions below supersede
earlier sections where they conflict.

### Identity and data

- The packaged app is **OSAT V2** (`ai.mccreery.osat.v2`) and stores its data
  in `~/Library/Application Support/OSAT V2` (`OSAT V2 Preview` when run
  unpackaged). It never reads the everyday app's `NateOS` folder. Move data
  between them with Settings → backup / restore; a V1 backup restores cleanly.
- Browser preview: `Start OSAT V2 Preview.command` → http://127.0.0.1:5220/.
  `Update OSAT V2.command` installs `/Applications/OSAT V2.app`, leaving
  `/Applications/OSAT.app` untouched.
- `npm test` runs every unit suite (54 checks). `node tests/offline-qa.mjs`
  drives the packaged app offline through Notes and the Mindmap and reads the
  local database back (run `npm run dist:mac` first).

### Notes (`src/notes/`, `src/notes-model.js`)

- Notes gained `folderId`, `pinned`, `archived`, `trashedAt`; the workspace
  gained `folders` (nested; a folder's `parentId` is validated and cycles are
  broken on normalize). Deleting a folder moves its notes up one level.
- Smart lists: All, Pinned, Recent (7 days), Daily notes (`daily-plan-*` ids,
  the existing Today convention), Unfiled, Archive, Trash. Trash is reversible;
  "Delete forever" and "Empty trash" confirm. Archived/trashed notes are hidden
  from Today's next steps, the AI context picker, boards and Obsidian export.
- `[[Note title]]` wikilinks resolve by title, case-insensitively; renaming a
  note rewrites the links that pointed at it; the inspector shows outgoing
  links and "Mentioned in" backlinks; clicking a missing link creates the note.
- The editor is a Markdown textarea with a toolbar, Write/Split/Read modes,
  list continuation on Enter, Tab indent, ⌘↩ task toggle, and `[[`/`#`
  autocomplete positioned at the caret (`caret.js`). Reading mode renders
  through `src/lib/markdown.jsx` (shared with Local AI); task checkboxes
  there flip the source line. Markdown stays byte-exact — TipTap is gone.
- Pure text commands live in `editor-commands.js` and are unit-tested.
- Search understands `#tag` tokens; tag chips in the organizer filter too.
  Multi-select (⌘/⇧-click) gets a bulk bar: move, pin, archive, trash.
  Notes drag onto folders; folders drag onto folders.

### Mindmap (`src/board/`, `src/board-model.js`)

- The iframe'd Sticky Note Sorter is gone. The board is native React and
  keeps its data shape (`workspace.sorter`): boards with cards, links, views,
  tag colours and a camera, now plus `scope`, `groups` (frames) and per-board
  `hidden`. V1 documents migrate: card `text` is dropped (the note is the
  source), `hiddenNoteIds` moves to the Desk board.
- **Every card is a real note.** A board's `scope` decides which notes it
  shows: `all` (the Desk — every active note, new notes land here), `folder`
  (a folder and its subfolders; "Open as board" in Notes makes one), or
  `manual` (only what you add). `reconcileBoards` runs on every commit that
  touches notes or folders, so cards appear and leave without a reload.
  Removing a card from an auto board hides that note there until it is added
  back; it never deletes the note.
- Layout algorithms are pure (`clusterCards`, `tidyGrid`, `findFreeSpot`,
  `fitCamera`, wire geometry). "Sort by tag" and "Cluster by folder" create
  titled frames per cluster (`auto: 'tag' | 'folder'`); manual frames are
  drawn around a selection (G). Dragging a frame moves the cards inside it.
- Wikilinks between notes on the same board draw as dashed wires (toggle in
  the rail). Real connections are dragged port to port, labelled by
  double-click, and support arrowheads.
- Geometry during a drag lives in component state and is committed on
  pointer-up; the camera is committed 500ms after it settles. Undo/redo is a
  local stack of board snapshots (cards, links, frames, tag colours).
- Keyboard: S cluster, ⇧S tidy, G frame, L link, ↩ edit, ⌫ remove from
  board, ⌘A/⌘D/⌘E, ⌘0 fit, ⌘±, arrows nudge, V/H tools, space pans, F search,
  N composer. Double-click the desk to start a note there.

### Shell

- ⌘\ (or the button beside the wordmark) collapses the sidebar to an icon
  rail; the choice persists in `osat.rail.v2`.
- `navigate(view, detail)` accepts a detail object: Notes takes
  `{ noteId | folderId | action: 'new' | 'today' | 'new-folder' }`, Mindmap
  takes `{ boardId, focusNoteId }`. The command palette searches notes
  (with `#tag` support), folders, boards, projects and actions.
- Saves still trail edits by 220ms but are forced at least every two seconds
  during continuous typing; the localStorage recovery copy is unchanged.
- The tour ("Explore a sample day") now seeds folders, wikilinks and tagged
  notes so the organization features have something to show.

## September 21 — Home redesign

Nate requested a fundamental redesign, with full creative control, not a recolor
or typographic refresh. OSAT is his comfortable, private place to unload many
thoughts, use offline AI, keep files, and see life at a glance. The infinite
Mindmap is essential for working through 200+ sticky notes. Orbit, Halo and Orchid
in the supplied Design Candidates folder are inspiration, not exact templates.
The current product must feel connected, personal, calm, and alive.

Review an editable local HTML/browser version first. Do not package or replace
an installed application during design iteration. This pass previews on
127.0.0.1:5221; its browser data is separate from the installed application.
A source rollback is in `.design-backups/before-home-redesign-20260921.tar.gz`.

New captures immediately create one canonical note and keep the original inbox
record linked through `originCaptureId`. Reopening a capture reuses that note.
Journal pages use `journal-YYYY-MM-DD` canonical notes. Home derives its overview
from the same records. Preserve existing data, board geometry, themes, native
file access, and explicit opt-in AI context. Keep sample data explicitly added.
The shared node_modules symlink requires a checkout-local Vite cache directory.

## September 22 — OSAT Field

This folder is `~/Desktop/OSAT Field`, a duplicate of OSAT V2. The original project and the installed OSAT V2 app are not modified by this copy. Nate asked for a new version with complete creative control.

The home is a desk. The new Sky view is every active note as a star: wikilinks are the strong lines, shared tags form chains, and the camera pulls back once when the sky opens. Sample notes are shown only when the desk is empty, and they are written into the workspace only from an explicit Keep. Dragged paper positions live in `osat.field.papers.v1`.

Identity is separate on purpose: app id `ai.mccreery.osat.field`, data folder `OSAT Field` / `OSAT Field Preview`, IndexedDB `osat-field-local-v1`, chats `osat-field-chats`, recovery key `osat.field.pending-workspace.v1`. Preview is http://127.0.0.1:5237/, opened with `Open OSAT Field.command`. Do not install over `/Applications/OSAT V2.app`. The old V2-named launchers were removed from this folder.

Filled views other than the desk and the sky leave 84px at the bottom for the dock. The dock replaces the side rail. Today and Sky are filled views and paint behind the dock.

## September 23 — the sheet

A paper opens on the desk. The title and the words are the same note Notes already keeps, and setting it down returns to the scatter. From the sky, laying a star on the desk opens that sheet. A sample page is not written until Keep. Views other than the desk and the sky use the same OSAT Field chrome, so leaving the room does not bring the old location bar back. Constellation names sit above their stars.

## September 23 — the spread (Claude)

This folder is `~/Desktop/OSAT Field copy`, a copy of the Grok-made OSAT Field. Nate gave full creative control. The original OSAT Field folder is untouched. This copy previews at http://127.0.0.1:5239/ (`Open OSAT Field.command`, `.claude/launch.json`), so its browser data stays separate from the original's port 5237. The decisions below supersede the September 22 and 23 sections where they conflict.

- **Navigation.** One bar across the top of every view: wordmark and "On this Mac" status, tabs (Today, Notes, Mindmap, Journal, Calendar, Local AI, ⌘1–⌘6), a More menu (Sky, Projects, Habits, Reflect, Money, Files, Inbox, Obsidian, Settings, All spaces), then search (⌘K), new thought (N) and theme. Phones get a bottom bar: Today, Notes, New, Map, More. The dock and the side rail are gone, so filled views no longer reserve 84px. `osat.rail.v2` is no longer read.
- **Motion.** Room changes use the View Transitions API. The active tab's pill is `view-transition-name: topbar-pill` and glides. `.workspace-content` is `workspace`, and `data-vt="room"` on the root tags a room change. Opening a paper morphs it into the sheet (`open-paper`), and setting it down morphs it back. Reduced motion skips all of it.
- **Today is a spread.** The left page is the day: greeting, a line for a thought (type anywhere), Next (open steps from every note with today's plan first, five shown; checking strikes it through and lets it leave), a 6a–midnight ribbon with events and a now marker, and tonight's journal page. The right page is the desk: up to nine papers (pinned, then recent, excluding `daily-plan-*` and `journal-*`), laid out in a staggered grid. Dragging saves to `osat.field.papers.v1`, and "Tidy" clears the saved positions. Phones stack the papers in two columns.
- **Tokens.** Paper is `--sheet*` and Today's desk is `--tabletop`. Never name a token `--paper-*` or `--desk`: `board.css` owns those on `:root` for the Mindmap, and a collision made dark-mode paper text invisible. The calendar owns `.day-events` and `.day-add`, so Today uses `.today-events` and `.next-add`.
- `excerpt()` drops inline `#tags`, since tags already show as chips.
- **Journal.** One ruled sheet, plus a margin question that changes daily. Dark mode uses a dark sheet for night writing. The capture dialog is a fresh sheet of the same paper.
- **Mindmap.** The dark palette is warm coloured paper on a dark desk, never navy.

## September 23 — desktop home (Claude)

Nate saw LYKN (lykn.io, a cloud AI launcher for the Mac) and loved how clean and tidy its home is. The home now borrows that look. This supersedes the spread described above. A rollback of the spread is in `.design-backups/before-desktop-home-20260923.tar.gz`.

- **Home** (`src/field/FieldDesk.jsx`, `src/styles/home.css`) is a desktop:
  - A blurred wallpaper: `public/images/wall-lake.jpg` or `wall-moss.jpg`, chosen from the dock's More menu and stored in `osat.home.wallpaper.v1`.
  - Top left: glass Day and Month widgets, with Next steps under them.
  - Top centre: a mode pill (Note, Next step, Ask, Search) over one composer.
  - Right: desktop icons from `homeItems()` (pinned notes, top-level folders, the Mindmap, recent notes, then "+N more"). Their collapse state is `osat.home.icons.v1`.
  - Bottom: a dock.
- **The dock appears on home only.** Rooms keep the top bar, so the dock never covers the Local AI composer, the Mindmap or the Notes editor. The top bar is not rendered on home.
- **The composer does one thing on Return**, chosen by the visible mode. The mode resets to Note on every visit, so stray typing always becomes a private note.
  - Ask checks the local model first. It only opens a new Local AI chat with the text waiting (`assistantTarget` is `{ prompt, at }`). Nothing is sent and no notes are shared.
  - Search opens ⌘K with the words.
- **Never add LYKN's cloud pieces to the home**: cloud models, Build, Imagine, Research or Voice modes, connectors, agents, Mac Desktop or wallpaper sync, third-party app icons, or a name in the greeting without a real Settings field.
- **Glass rule.** `backdrop-filter` only blurs what shares its backdrop root. The wallpaper is a sibling layer inside `.home`, and no element that contains glass may carry opacity, filter or a view-transition name. Animate each glass element itself.
- **Tokens.** Glass and wall tokens live in `tokens.css`: `--glass*`, `--wall-*`, `--on-1..4`, `--on-solid*`, `--home-*`. The Calendar owns `.month-grid`, so the widget uses `.mini-month`.
- `osat.field.papers.v1` is kept but no longer read. The unit suite is 80 checks.

## September 24 — Mac app: browser, clipper, terminal (Claude)

- **This folder is now the OSAT Field Mac app** (`ai.mccreery.osat.field`, data folder `~/Library/Application Support/OSAT Field`). It has its own `node_modules`; the old symlink into NateOS-Prototype is gone. `Update OSAT Field.command` (`npm run install:mac`) builds and installs `/Applications/OSAT Field.app`. `release/` also holds a DMG and a zip. Builds are ad-hoc signed until there is an Apple Developer ID.
- **Browser** (`desktop/browser.cjs`, `src/tools/Browser.jsx`, ⌘7 / ⌘T): real Chromium tabs in the `persist:osat-browser` session, laid over `.browser-page` by the main process.
  - Pages load http(s) only, get no permissions beyond fullscreen, and can't reach OSAT's preload.
  - The native view hides whenever the room is covered: the capture dialog, ⌘K, any open `Menu` (it sets `data-menu="open"` on `<html>`), or another room.
- **Clip to OSAT** turns the selection, or else the page's description or opening text, into an ordinary note tagged `#clip` via `clipMarkdown()` (`src/tools/address.js`, tested). Nothing on a page reaches Notes without that click.
- **Terminal** (`desktop/terminal.cjs`, `src/tools/Terminal.jsx`, ⌘8 / ⇧⌘T): `node-pty` sessions live in the main process and survive room changes; the renderer uses xterm.js. There is no terminal in a Mac App Store build (`process.mas`); the room says so.
- **The menu bar** carries every room (⌘1–⌘8), New Thought (⇧⌘N), New Note (⌘N), Search (⌘K) and Settings (⌘,). Commands reach the renderer as `app:command` and go through `navigate()`. The window remembers its size and position (`window-state.json`), and the Dock menu has New Thought, Local AI and New Browser Tab.
- In the browser preview these rooms say honestly that they live in the Mac app. The unit suite is 82 checks.
