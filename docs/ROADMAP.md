# OSAT roadmap — from sprawling prototype to a calm Mac MVP

## Status

| Phase | What | State |
|---|---|---|
| 0 | Foundation and cleanup | Merged (PR #1) |
| 1 | Final data shape and one source of truth | Merged (PR #1) |
| 2 | The overlay (LYKN-style layer with pop-outs), Spotify, movable widgets | Merged (PR #2) |
| 3a | One place: the desk, glass sheets, one navigation, Settings sections | Merged (PR #3) |
| 3b | A calm day: Next ≤ 5 + bring forward (in #3), evening invitation, Undo, See in the Sky | Merged (PR #4) |
| 4 | Local AI that sets itself up, Ask everywhere, chats in the workspace | Merged (PR #5) |
| 5 | Your iPhone, step one: capture from the phone, read your notes there | Merged (PR #6) |
| 6a | Sync: devices stay in step through iCloud (Mac ↔ Mac now, the iPhone app next) | Merged (PR #7) |
| 6b | The iPhone app | Merged (PR #8) |
| 7 | Visual polish | Merged (PR #9) |
| 8 | Your Mac's files in OSAT, the quick chat, Ask reads files | Merged (PR #10) |
| 9 | One desk: the window and the ⌥Space layer become one | Merged (PR #11) |
| 10 | A living desk: one line for everything, widgets that open, Incognito (going under) | Merged (PR #12) |
| 11 | Nodes: the Sky above the desk, stickies on the desk, the scratch page under it, a neutral look | Merged (PR #13) |
| 12 | Make it simple: one word per thing, names without numbers, @ only links, plain Help me sort, Import a node file, Projects fold into nodes, Reflection lives in the Journal, Appearance under Tools | Merged (PR #14) |
| 12b | Offline mode: Incognito becomes a switch on the line instead of a place | Merged (PR #15) |
| 12c | The roadmap inside OSAT: Tools → Roadmap shows this page | In review (with Phase 18, PR #18) |
| 16 | Clear nodes: an open node is drawn as a tree, only stickies are paper, "How the Sky works", New branch inside | Merged (PR #19) |
| 13 | Mac powers: quick search that feels like Raycast (files and the clipboard with a big preview, Return and ⌘K actions), the line becomes a launcher (Hyper key, keywords, math, `>` for a bot), a clipboard that files itself, the ring, window snapping, the Tools wheel, a movable dock, resizing | Planned |
| 14 | Connectors: Apple Mail, Gmail in the browser, Outlook; Calendar and Reminders; Messages beside OSAT | Planned |
| 15 | Paper in: a scan (the Brother, or the iPhone's Scan Documents) becomes a sorted node; dates are offered to the Calendar | Merged (PR #17, done before 13 and 14) |
| 17 | Make it yours: backdrops, About you (lines the AI reads first), the Browser on the dock as Web | Merged (PR #20) |
| 18 | Bots in: Muse (and Grok Bot, Claude) put nodes into OSAT through a drop folder; packed nodes to unpack; cloud models (DeepSeek first, any provider); a Timeline in the Roadmap; OSAT's connector with a key | In review (PR #18) |
| 19 | OSAT's own bots: a Bots room in the dock (a customer manager, a follow-up bot, an Inbox sorter, a research bot), people cards, a morning page | Planned |
| 20 | Capture anywhere: the clipper works in every app and remembers where things came from; hold a key and talk | Planned |
| 21 | Find and tidy your files: search inside files, move / rename / new folder / Bin with Undo, one drag system (files too, in and out of OSAT) | Planned |
| 21b | A tidy desk and folders: Tidy my Desktop (AI proposes, Nate ticks), an optional folder layout | Planned |
| 22 | Files in the Sky: toss a file up as a card, a node can link a real folder (schema 8) | Planned |
| 23 | Nodes become projects: Track it (Done / Now / Next), Rush it, on top of the Roadmap's Timeline | Planned |
| 24 | Sort a pile: a table of its own to toss a pile of stickies down, group them, ask for help, then send it to the Sky | In review (PR #21, done before 21–23) |

**Paused (Sep 26):** the iPhone/iPad app is parked for now; work is on the Mac app only. Its code and
CI build stay as they are, ready to pick up again.

**The end goal (Nate, Sep 25):** an app that syncs with his iPhone. Phases 5 and 6 get there;
visual polish moves after them.

## Context
OSAT Field is Nate's personal, local-first "second brain" Mac app: React 19, Vite 6 and Electron 43, about 10.5k lines of JS and 7.5k lines of CSS, with 82 unit tests covering only the pure data-model code. It was copied and redesigned five times (NateOS → OSAT → OSAT V2 → OSAT Field → "OSAT Field copy"). Each pass layered new rooms, docs and compatibility code on top of the last. It was just pushed to GitHub (`SouthernSimp/Claude-OSAT-Cloud`, `main` = one "Initial import" commit).

Nate gets lost in it:
- about 19 rooms
- the list of rooms written out in about 15 places
- settings and sub-menus with no clear home.

He wants an MVP **for himself**: calm, anxiety-reducing, good-looking and unique. It should center on a **summon-anywhere overlay** (inspired by lykn.io, but private and local), with **local AI models that download on first launch**. Mac comes first, phone capture later, the App Store eventually (he has an Apple Developer account). He is new to GitHub, so Claude runs the repo.

## Nate's answers (Sep 25)
- **Overlay:** a **summon panel** on ⌥Space. He'd use all four jobs weekly: unload thoughts, see & sort, run the day, think with local AI.
- **Merge, don't delete.** He'd miss Browser, Terminal, Calendar, Habits/Reflect, Money, Projects, Files and Sky. He should never feel lost.
- **No important data yet, so a clean start.** No migration code; all legacy compatibility goes.
- **One app named OSAT** replaces OSAT.app, OSAT V2.app and OSAT Field.app. Old apps are renamed aside, never overwritten, and their data is untouched.
- **Ask uses notes automatically,** shown as removable chips.
- **GitHub:** Claude drives. One PR per phase; CI builds a DMG; Nate tries it and says "merge"; Claude merges.

## What already exists (web research)
- **[LYKN](https://lykn.io/):** a cloud multi-model AI chat bar on the desktop, with a memory vault. Cloud-based, paid tiers, not a notes tool.
- **[Raycast Notes](https://www.macstories.net/reviews/raycast-overhauls-its-notes-feature/), [Unfriction](https://unfriction.app/), [Capture](https://www.capture.surf/), [SlashNote](https://slashnote.app/quick-capture/):** fast floating capture, with nothing behind it to organize or think with.
- **[Reor](https://github.com/reorproject/reor), [Khoj](https://github.com/khoj-ai/khoj), [Obsidian + Smart Connections](https://github.com/brianpetro/obsidian-smart-connections):** local-AI knowledge bases. They are full-window workbenches and need setup (Ollama, a server, or a plugin).
- **Where OSAT stands apart:** it opens from anywhere, gives a spatial map of your own thinking, and has AI that **installs itself inside the app** and only *suggests*. Being calm by design is the differentiator.
- **Feasibility:**
  - Electron supports `type:'panel'` (NSPanel: non-activating, floats over full-screen apps and appears on every Space).
  - [node-llama-cpp](https://withcatai.github.io/node-llama-cpp/guide/) runs llama.cpp with Metal inside Electron and can download GGUF models from Hugging Face.

## Audit — what's wrong today
- **Too many rooms, no single definition.**
  - About 19 rooms, plus Ideas and Gmail views nothing links to (`App.jsx:391,400`).
  - The room list is written out about 15 times: `App.jsx:42-43,236,358`, `lib/modules.js`, `FieldChrome.jsx` TABS/MORE/DOCK, `More.jsx`, `CommandPalette.jsx:42`, `desktop/main.cjs:422-440`.
  - The copies already disagree. "More" is also called "All spaces" and "Library". The Mac menu leaves out Inbox, Reflect and Obsidian. ⇧⌘L is bound twice.
- **Four editors for one note:** `NoteEditor`, `FieldSheet`, the Mindmap card editor and the Journal textarea. Each saves differently.
- **Every thought is stored twice:** as a capture record and as a note (`notes-model.js:327`). So Inbox duplicates Notes, and Ideas can never be filled.
- **Islands:** budget, habits, reflections, calendar and projects link to nothing. Reflect's "next honest step" never becomes a step.
- **Tags silently dropped:** tags set by code (journal, today) disappear on the next keystroke (`notes-model.js:342`).
- **Data-safety bugs:**
  - The localStorage recovery copy is never cleared and wins at launch (`osat-store.js:73-86`).
  - Windows overwrite each other's work (`App.jsx:470`).
  - A quick capture is silently lost when the main window is closed (`main.cjs:614`).
- **Cost of one keystroke:** it rewrites wikilinks in every note, rebuilds every board and writes the whole workspace to localStorage.
- **Dead code:**
  - `osat-crypto.js`
  - the secret vault (it can store secrets but nothing reads them)
  - `experience-tour.js`
  - the V1 `mindmap` field, still cleaned up on every save
  - 15 `nateos.*` keys
  - the Sites worker (it makes `npm test` fail on a fresh clone)
  - the offline-web (PWA) service worker
  - about 2 MB of unused images.
- **Duplication:**
  - 5 id generators
  - 4 search functions
  - 5 wikilink patterns
  - 2 daily-plan creators
  - 3 IndexedDB wrappers
  - the LM Studio client three times.
- **Styling:**
  - 13 CSS files
  - 49 font sizes
  - 20 z-index values
  - `board.css` defines 49 of its own tokens
  - leftover alias tokens.
- **Docs** contradict the code and each other on ports, names, test counts and `/Users/nate/...` paths.
- **Platform:**
  - The terminal (your full login shell) can be reached from every window.
  - No single-instance lock.
  - No CI, lint or signing.

## Direction
**OSAT is a calm, private layer over your Mac.** Press ⌥Space anywhere to drop a thought, ask your own notes, or see what's next. Open the window when you want to sort and think. Everything, including the AI, stays on the Mac.

The core loop is **Unload → Sort → Act**, with Ask available everywhere.

| Now (about 19 rooms) | MVP |
|---|---|
| Home desk with wallpaper, Inbox, Ideas, capture dialog, quick-capture window | **Overlay** (⌥Space): a Note / Find / Ask line, Next, Recent. The menu-bar icon always works. |
| Today, Journal, Reflect, Habits, Calendar | **Today:** date and month picker, Next, schedule, the day's page, habit chips, 3 optional evening prompts |
| Notes, Inbox/Ideas | **Notes:** Unsorted, All, Pinned, folders |
| Mindmap, Sky | **Map:** boards, with a *Board / Sky* toggle |
| Local AI, AI pop-out window | **Ask:** chats grounded in your notes |
| Browser, Terminal, Money (plus Projects and Files until they merge into Notes after the MVP) | **Tools** menu at the end of the tab bar, also in ⌘K and the Mac menu bar |
| Settings, Obsidian, "All spaces", More, Gmail, mobile bar, Focus timer, wallpapers | **Settings** sheet (⌘,): General · AI · Appearance · Data · About. The rest is removed. |

**Shortcuts:** ⌥Space overlay · ⌘1–4 Today / Notes / Map / Ask · ⌘K do anything · ⌘N new note · ⇧⌘N new thought (goes to Unsorted) · ⌘, Settings.

**Calm rules** (these go into the new CLAUDE.md):
1. Each screen has one obvious primary action.
2. Nothing is lost: an Undo toast instead of scary confirm dialogs.
3. No nagging counts or red badges.
4. Esc always backs out; ⌘K always finds anything.
5. Every space has the same layout, driven by one nav definition.
6. Plain words: Unsorted, not Inbox/records/canonical.
7. Saving is invisible unless it fails, and then it's a calm banner with Try again and Show data folder.

## Phases
Each phase is its own PR. CI must be green, and Nate tries the DMG before merge.

### Phase 0: Foundation and cleanup (how data is stored doesn't change yet)
**Delete**
- Hosting leftovers:
  - `worker/`, `.openai/`, `scripts/prepare-sites-build.mjs`, `tests/sites-worker.test.mjs`
  - `public/service-worker.js`, `public/pwa-register.js`, `public/manifest.webmanifest`
  - the manifest, apple-* and pwa-register tags in `index.html`
- Dead features and their bridges:
  - `src/osat-crypto.js` and its test
  - `desktop/secret-vault.cjs`, the `secrets:*` handlers at `main.cjs:563-573`, and `osatSecrets` in the preload
  - `src/experience-tour.js`
  - the views `Ideas`, `More`, `MobileNav`, `Disconnected` (Gmail), `FileShelf` and `lib/file-store.js`
  - **the AI pop-out window** (`AssistantSurface`, `osatWindows`, the ⇧⌘L menu item and the Dock item)
- Unused assets and old docs:
  - unused `public/assets/*`, `design/*`
  - the old docs `AGENTS.md`, `NATEOS_HANDOFF.md`, `OSAT-START-HERE.md`, `OSAT-TODAY.md`, `design-qa.md`
  - `tests/offline-qa.mjs`, `tests/electron-qa-entry.cjs`, `.claude/launch.json`
- The orphan CSS selectors found in the audit.

**Rename to OSAT**
- `package.json`: name `osat`, version `0.1.0`, `build` = `vite build`, appId `ai.mccreery.osat`, productName `OSAT`, artifacts named `OSAT-${version}-${arch}.${ext}`. Regenerate the lockfile.
- `main.cjs:31`: the data folder is `OSAT` when packaged and `OSAT Dev` otherwise. On first launch, if an `OSAT` folder exists without the `osat-store.json` marker, rename it to `OSAT (before <date>)`. Nothing is deleted.
- `scripts/install-mac.mjs`:
  - Read the bundle id of `/Applications/OSAT.app`. If it isn't `ai.mccreery.osat`, move it to `OSAT (old).app`.
  - If it is ours, remove it before copying; today's `ditto` merges files and leaves stale ones behind.
  - Quit the running app by bundle id.
- Launchers: `Update OSAT.command` without the Codex PATH. Delete the web-preview launcher.

**Tooling**
- `.github/workflows/ci.yml`:
  - ubuntu job: `npm ci`, `npm test`, `vite build`, and a Playwright smoke test of the web preview that takes screenshots
  - macos-latest job: `electron-builder --mac dmg --arm64`, uploaded as a PR artifact.
  - Caches for Electron and electron-builder. `ELECTRON_SKIP_BINARY_DOWNLOAD` on ubuntu. node-pty is optional on ubuntu.
- **Signing:** use the Developer ID certificate and an App Store Connect API key from GitHub secrets. Nate does this once and Claude walks him through it. Until it's set up, builds are ad-hoc signed and each PR explains the "Open Anyway" step.
- Add a separate `OSAT Dev` data folder for unpackaged runs.

**Docs:** a new `CLAUDE.md` (current truths, calm rules, commands, a map of the architecture) and a rewritten `README.md`.

**Tests:**
- Remove the tests for deleted code: crypto, sites, vault, service worker, file shelf, tour.
- Rewrite `platform-bridge` #6 to check the new identity.

### Phase 1: Final data shape and one source of truth
This lands before the overlay. The overlay is a window that must work while the main window is closed, and today every window overwrites the others.

**Final schema (1), settled now while a clean start costs nothing.** The file also ships a `migrations[]` list, empty for now.
```
{ schema:1, rev, theme,
  notes:[{id,title,markdown,tags,createdAt,updatedAt,folderId,pinned,archived,trashedAt,unsorted?,source?,kind?,date?}],
  folders:[{id,name,parentId,createdAt,collapsed}],
  sorter:{activeId,showWikilinks,boards:[…]}, habits, calendar:{events}, budget:{currency,transactions,recurring},
  projects:[], chats:[…] }
```
Removed from the schema: `records`, `capture`, `savedIds`, `legacySnapshot`, `importedLegacyAt`, `mindmap`, `reflections`, `focus` and the seed data.

**Store in the main process**
- `shared/store-core.js`, pure ESM used by main, the renderer and the tests:
  - `createEmptyDoc()`, `validateOps`, `applyOps(doc, ops)` returning `{doc, inverse}` (the inverse gives Undo), `migrations[]`
  - operations: `add` (ignored if the id exists) · `patch` (only changed fields) · `del` · `set`.
- `desktop/store/file.cjs`:
  - atomic write (temp file, fsync, rename), extending `main.cjs:134-148`
  - a fallback chain: `workspace.json`, then the newest snapshot, then an empty document (a corrupt file is kept aside)
  - 14 daily snapshots.
- `desktop/store/index.cjs` (`createStore({dir, fs, clock})`):
  1. validate the operations
  2. apply them and increment `rev`
  3. write to disk (250ms after the last change, 1s at most)
  4. reply to the sender
  5. broadcast `store:changed {rev, ops}` to the **other OSAT windows only**, never to browser tabs.
  - Also a `store:status` channel. `before-quit` flushes to disk (3s limit).
- Renderer:
  - `src/store/{diff,client,useWorkspace,bridge-electron,bridge-web,bridge-memory}.js`
  - `commit(updater)` stays synchronous, so **all 68 existing call sites keep working**.
  - The client compares old and new state to produce operations, merges them per entity and sends a batch about every 120ms.
  - It keeps "confirmed by main" and "still pending" apart, which prevents echo loops.
  - On `pagehide` it sends synchronously; when the window becomes visible it reloads if main has moved ahead.
  - The web bridge (IndexedDB `osat-preview` plus `BroadcastChannel`) keeps the browser preview working in the cloud. `?fixture=demo` loads sample data.
- `main.cjs`:
  - load the store before creating any window
  - `requestSingleInstanceLock`
  - track window roles, so `terminal:*`, `browser:*` and `files:*` only work from the main window
  - quick capture writes through the store.
- `preload.cjs`: one `window.osat` namespace (`store`, `files`, `ai`, `browser`, `terminal`, `app`).

**Delete the legacy code**
- `src/osat-store.js`, and `useWorkspace` in `App.jsx:55-162`.
- In `osat-data.js`, lines 14-392 (legacy keys, seed data, the V1 canvas, legacy import, schema-1 restore). The money, ICS and URL helpers move to `src/model/format.js`.
- In `note-core.js`: the field aliases and `originCaptureId`. Keep the new fields in the whitelist.
- `board-model.js`: `LEGACY_PAPER` and `hiddenNoteIds`.
- `chat-store.js`: `migrateLegacy` (conversations move into the store).
- `main.jsx:20`: the `nateos.theme` read.

**Fix while we're here**
- `captureThought` creates one note with `unsorted:true`. The AI "capture" action uses it too.
- A single `ensureDayNote(date)` (id `day-YYYY-MM-DD`, `kind:'day'`) replaces the three separate creators.
- Wikilinks are renamed on title blur or Enter, not on every keystroke.
- `reconcileBoards` returns the same object when nothing changed, and only runs when the note/folder signature changes.

**Tests:**
- New: `store-core`, `store-file` (failed write, corrupt file, snapshot rotation), `store-diff` (one keystroke produces exactly one note patch), `store-client` (two windows in memory, no echo, no lost updates).
- An Electron end-to-end test under xvfb in CI.
- Delete the legacy tests.

### Phase 2: The overlay, a LYKN-style layer over your real desktop
**Updated Sep 25 from Nate's LYKN screenshot.** He loved it and wants "the pop-out thing and the same freedoms". LYKN is not a small panel. It is a full-screen layer over the real desktop:
- the wallpaper is blurred behind it
- glass widgets on the left (day, month, a recent-items card)
- one line with modes at the top centre
- desktop icons on the right (Files, Vault)
- a dock at the bottom with its own tools plus launchers for Nate's other apps
- tools such as its browser open as **floating pop-out windows** on top of the layer.

OSAT's current in-window home already copies this look. Phase 2 makes it real, and keeps every one of LYKN's cloud pieces out.

- **`desktop/overlay.cjs`** (dependency-injected; the pure pieces are unit-tested):
  - The layer is a full-screen, frameless, transparent `BrowserWindow` on the display under the cursor. On the Mac it uses `type:'panel'` and `vibrancy` (the real desktop blurred behind it; no fake wallpaper) and shows over full-screen apps and on every Space.
  - It is created hidden at launch and only ever hidden, never closed, so it opens instantly with live data from the store.
- **⌥Space** shows or hides the layer. If `register()` fails (Raycast or ChatGPT often own it), a **hotkey picker** appears, and the choice is saved in Settings. A menu-bar `Tray` icon offers Open OSAT and AI status. Launch at login.
- **Contents:** `src/surfaces/overlay/`, built by reusing `FieldDesk`, `HomeDock`, `homeItems` and `next-steps`.
  - Top left: glass Day and Month widgets, with Next underneath.
  - Top centre: a mode pill (**Note · Find · Ask**) over one line. Note writes an unsorted note; Find searches everything. Ask arrives with the Phase 4 runtime.
  - Right side: desktop icons for pinned notes, folders and boards.
  - Bottom: a dock with Notes, Map, Today, Ask and Tools, plus **app launchers** (Nate picks Mac apps; OSAT opens them with `shell.openPath`).
- **Pop-outs:** a note, a board, the browser, the terminal or Ask opens as a **floating glass window on the layer**. The pop-outs can be dragged, resized and closed; Esc closes the top one, then the layer. "Open in window" sends any pop-out to the full OSAT window for deep work.
  - The browser pop-out reuses `desktop/browser.cjs` (its native view is placed inside the pop-out's frame).
  - Note pop-outs use the single `NoteEditor`.
- The layer replaces the quick-capture window and the in-window desk home. The browser preview shows the layer over a mock desktop image, for Playwright.

### Phase 3a: One place (updated Sep 25 from Nate's notes)
Nate asked to condense and connect desk → notes → sky → mindmap, make the mouse bring things to life without clicking, add a blur setting, reduce clutter (and make clutter feel OK), take the calm of the ChatGPT build's Notes, and go "liquid glass, Raycast/Apple, rich transitions" everywhere.

**Built:**
- `src/lib/spaces.js` is **the one definition**: Desk · Notes · Map · Ask, plus Tools (Today's page, Calendar, Habits, Reflect, Money, Projects, Files, Browser, Terminal) and Settings. The dock, sheet titles, ⌘K and ⌘1–4 read from it; the Mac Go menu mirrors it by hand (it can't import the React icons). The top bar and `modules.js` are gone.
- **The desk is always underneath.** Every room is a glass sheet (`src/shell/Shell.jsx`) that grows out of what you clicked and sinks back into its dock button; the desk recedes behind it. Esc backs out one step (out of a field, then to the desk).
- **Map = Board + Sky.** A switch in the sheet; going Board → Sky pulls back until the cards are stars, Sky → Board dives in (view transitions).
- **Glass kit** (`src/shell/glass.jsx`, `src/styles/glass.css`): liquid-glass edge refraction (an SVG displacement map, Chromium only), a rim light, a soft light that follows the cursor on every piece of glass, a Mac-style dock that swells under the cursor, the wallpaper drifting slowly and leaning away from the mouse, a sheen across the greeting. All of it rests when the mouse rests; reduced motion turns it off.
- **Every room rethemed** by scoping the design tokens inside `.room-sheet` (and the layer's pop-outs) to see-through values, so Notes, Map, Ask, Calendar, Money, Habits, Settings, Browser and Terminal all wear the same glass.
- **Appearance** (the dock's Look button, the layer's dock, and Settings): Auto/Light/Dark, wallpaper, and a **Blur** slider saved in `settings.blur` (no schema change). On the layer, Blur sets the veil, and zero takes the Mac's frosting off entirely.
- **Less clutter on the desk:** pinned notes, folders, the Map, then **loose thoughts gathered in one pile** that fans open under the cursor, then only the 4 most recently touched notes. Resting on a note lights up the notes it links to and their folders.

**Also landed in #3:** Settings in five sections (General, Appearance, AI, Data with the Obsidian export and Show data folder, About); ⌘K as a glass palette.

**Still to do (Phase 7):** retiring `field-sample.js`, the Focus timer look, habit chips on the desk.

### Phase 3b: A calm day (merged, PR #4)
**Built:** Next shows at most five, with "Bring N from earlier days"; an evening invitation to Reflect (once a day); Undo instead of a question when trashing in Notes; See in the Sky from any note.

**Not built, still wanted (folded into Phase 7):** the single Today room below. The desk already covers most of it (Day/Month widgets, Next, today's page from Tools), so the remaining pieces are the evening answers writing into the day note, Unsorted row actions, and retiring the separate Journal/Habits/Reflect rooms.
- A date header with a month picker, reusing the grid from `Calendar.jsx`.
- **Next:** at most 5, the rest collapsed. Unchecked steps from earlier days show as a one-tap "bring forward" offer.
- **Schedule:** that day's `calendar.events`.
- **Page:** the day note, which serves as the journal.
- **Habit chips:** from `daily-practice.js`.
- **Three optional evening prompts:** answers are written into the day note, and "next honest step" becomes a `- [ ]` on tomorrow's page.
- **Notes:** Unsorted sits first in the sidebar (a soft dot, no count). Rows offer Move… / Keep / Add to Today / Trash with Undo.
- **One note editor** (`NoteEditor`), used everywhere. Map cards and Today's page embed it.
- Delete the Journal, Reflection, Habits, Inbox and Calendar room views and their CSS.

### Phase 4: Local AI that sets itself up (merged, PR #5)
- **The engine** (`desktop/ai/runtime.cjs`) runs node-llama-cpp 3.21 with Metal in an Electron `utilityProcess`, so a model that runs out of memory can't take the notes down. It starts on the first question and rests after ten idle minutes. LM Studio still works alongside (its loaded models appear in Ask); Ollama was left out (Nate uses LM Studio).
- **Three sizes** (`desktop/ai/catalog.cjs`), all Google's Gemma 4 (Apache 2.0, Google's own 4-bit QAT files), pinned to a revision with size and SHA-256: **Light** E2B 3.3 GB (8 GB Macs), **Balanced** E4B 5.2 GB (16 GB), **Deep** 26B-A4B 14.4 GB (32 GB+). `pickTier(memory)` recommends one; Nate's 64 GB M5 Pro gets Deep. Gemma's "thinking out loud" is turned off for calm, direct answers.
- **Downloads** resume from a `.part` file after a quit, sleep or dropped connection, retry calmly, check free disk first and verify the SHA-256. Progress shows in Settings → AI and the menu-bar icon.
- **First launch** (`src/shell/Welcome.jsx`): what stays private → the shortcut → the AI's size, recommended one preselected. Esc or "Not now" skips.
- **Ask everywhere:** on the desk and the ⌥Space layer, Ask mode answers right under the line (Keep talking · Save as a note). The Ask room reads the notes that match each question, shown as removable chips, and links them under the question. Action cards appear only when the question asks for something to be added.
- **Chats live in the workspace** (schema 2, with a migration and a test), so every window shares them; backups from schema 1 still restore.
- **Checks:** unit tests for the catalog, resumable/verified downloads and the engine lifecycle (a fake engine); the Electron end-to-end test walks the welcome and asks on the desk with a practice model; `--osat-self-test[=model.gguf]` proves the engine (and a model) work inside the built app, and CI runs it on every Mac build.
- Fixed on the way: Stop in Ask never worked in the Mac app (an AbortSignal can't cross the preload bridge).

### Phase 5: Your iPhone, step one (merged, PR #6; no iPhone app needed)
Opt-in in **Settings → iPhone**, because it is the first thing that leaves the Mac: it goes through Nate's own iCloud Drive (end-to-end encrypted only with Advanced Data Protection on; OSAT says so plainly). Until it's on, OSAT never touches iCloud Drive (macOS asks first).
- **Capture from the iPhone:** an `OSAT` folder in iCloud Drive with an `Inbox`. Any text file dropped there (an "Add to OSAT" Shortcut, Share → Save to Files, or the Files app) becomes a thought in Unsorted a few seconds after iCloud brings it; the file then moves to `Inbox/Added`, so nothing is lost. Files still arriving wait for the next look.
- **The Shortcut:** Settings shows four short steps to make it (Ask for Input or Dictate Text → Save File to OSAT/Inbox). A generated, signed `.shortcut` file was left out: it can't be tested without an iPhone, and a broken one would be worse than four steps.
- **Read on the iPhone:** a read-only Markdown copy of every active note in `OSAT/Notes`, in the same folders (Unsorted and Days get their own). It follows renames, moves and the Trash. OSAT only ever changes files it wrote, and turning the link off removes the copy.
- Rooms say "This Mac, and a copy in your iCloud" while the link is on.
- `shared/note-core.mjs`: the note record moved to `shared/` so the main process makes notes exactly like the windows.
- Checks: unit tests for the inbox (text becomes one thought, the file moves, half-synced files wait, hidden and non-text files stay) and the copy (folders, renames, trash, name clashes, a tampered manifest can't reach outside `Notes`); the Electron end-to-end test drops a file into a stand-in iCloud Drive and watches it arrive.

### Phase 6a: Sync (merged, PR #7)
- **How it works:** every change a device makes is an operation (the store already speaks in them) with a hybrid-clock stamp. Each device writes only its own numbered files in `OSAT/Sync/<device>/`, reads everyone else's, and merges field by field, newest stamp winning, so every device ends up the same whatever order iCloud delivers things in. A snapshot per device lets a new device (the iPhone) catch up without reading all history.
- **On the Mac** it rides the iPhone switch in Settings. Once set up it notes changes even while the switch is off, and sends them when it's back on. Two Macs with OSAT already stay in step.
- **Checks:** a randomized test (thousands of random edits on four devices, heard in random orders, a late joiner from a snapshot: always identical), engine tests (out-of-order files, damaged files, restarts), two real stores sharing a folder, and two real OSAT apps side by side in the end-to-end test.
- **Nothing lost when both write at once:** note text written on two devices without seeing each other (the Mac and the iPhone both adding a step to today's page) keeps both: the newer text plus the lines only the other had. Each note's text carries a version vector to tell "written on top of" from "written at the same time"; the device that merges shares the result, so all devices settle on the same text (random tests with three devices writing the same notes: always identical, never a lost line).
- **Fixed on the way:** finishing the welcome saved two settings at once, and the saves could collide so the welcome came back; saves now take turns.
- **Not yet:** old change files are kept (a clean-up can come when there are many).

### Phase 6b: The iPhone app (merged, PR #8)
- **The app:** three pages. **Today**: drop a thought or a next step, tick off Next, bring earlier steps forward, see Unsorted and recent notes. **Notes**: search, All / Unsorted / Pinned, a full-screen page to write in (Keep, Pin, Trash with Undo). **iCloud**: whether it's in step with the Mac, and Light/Dark.
- **How it's built:** the same React app and the same store and sync engine as the Mac (`?surface=phone`), inside a small SwiftUI app (`ios/`) that serves it through an `osat://` scheme and gives it its own files and its iCloud folder. The Mac moves its OSAT folder into the app's iCloud folder once it exists, so both share one.
- **Checks:** the phone's store and sync against a stand-in Swift side (unit test, and in the browser smoke test: it catches up from a Mac snapshot and sends its own change); the Mac's folder handoff (nothing lost); CI builds the app for the iOS simulator and screenshots it.
- **To put it on the iPhone:** open Xcode once (its license), `brew install xcodegen`, `npm run ios`, pick the team, Run (docs/IPHONE.md).
- **Later:** TestFlight from CI (an App Store Connect API key as a GitHub secret), Ask on the phone (Apple's on-device model or asking the Mac), a share extension and widgets.

### Phase 7: Visual polish (PR #9)
- **Tokens only:** the old alias names (`--blue`, `--danger`, `--shadow-sm`…) are gone, unused tokens removed, Mindmap's paper colours moved into `tokens.css`, one Fraunces font declaration. Type is 8 steps (`--t-2xs`…`--t-3xl`) and ~200 hand-typed font sizes now use them; app-wide layers have `--z-*` tokens; 17 breakpoints became three (1100 / 900 / 720).
- **Undo everywhere (calm rule 2):** one `useUndoToast()` for Notes, Money and Calendar. Deleting a folder, a board, a note for good or emptying the Trash no longer asks a scary question: it happens, and Undo is there. Money entries and calendar events, which vanished without a word, now offer Undo too. The two copies of the toast style became one glass pill.
- **Calm motion:** one global reduced-motion rule plus the glass one; three duplicates removed.
- Screenshots of every room before and after show no visible change other than text sizes snapping by half a pixel.
- **Not done, on purpose:** the "7.5k → 4k lines" target. Nearly every rule is in use (a scan found only a handful unused), so the rest would mean rewriting rooms that work. Empty states already teach one step.

### Phase 8: Your Mac's files, and a quick chat (PR #10)
Nate, Sep 26: "view my files on my computer inside OSAT… see all the files that sit on my normal
desktop… explore further down a folder", "the mini pop out chat that almost any AI desktop app
has now", and three improvements of Claude's choosing. He'd like to "eliminate the need for two
layers eventually".
- **The Desktop on the desk.** The right side of the desk (and the ⌥Space layer) shows the files
  on the Mac's Desktop with their real icons and Quick Look thumbnails. Click picks, double-click
  or Return opens, Space is Quick Look; a folder opens in Files. A small switch shows OSAT's own
  notes and folders instead.
- **Files is a small Finder** and a fifth space (⌘5): Desktop, Documents, Downloads and folders
  you add; back and forward; a path you can click; an info pane with a large preview, Open,
  Quick Look, Show in Finder and Ask about it. On the layer it's a pop-out.
- **The quick chat (⌥⇧Space):** Ask in a small window that floats over every app and every
  Space, stays where you leave it, keeps the chat you were in, and opens in the OSAT window when
  you want room. Pop out from the Ask room or the desk's answer. Its shortcut is in Settings.
- **Claude's three:**
  1. *Upgrade:* ⌘K finds files on the Mac too (Spotlight, by name, only in those folders).
  2. *Add:* Ask reads files: drop one on any chat, attach one, or Ask about it from Files. Text,
     Markdown, PDFs and Word files, read by the Mac's own tools.
  3. *Remove:* the sample room (its banner, Keep/Start blank, `field-sample.js`) — the Desktop
     now fills a new desk — and the "7 open" count on Next (calm rule 3).
- **Fixed on the way:** adding an app to the layer's dock used `app.getFileIcon(…, 'large')`,
  which crashes Electron 43 on the Mac.
- **Safety:** only Desktop, Documents, Downloads and folders you add; hidden files never show;
  apps, scripts and installers are shown in Finder, never run from OSAT; a dropped file's path
  comes from the preload, never the page.
- **Not yet:** moving, renaming or trashing files; dragging files out of OSAT; a list view.

### Phase 9: One desk
Nate, Sep 27: "make sure we have the one layer but also still the popout window for quick chat".
His choices: the desk is a real window; rooms open as pop-outs you can drag; the real desktop,
blurred, sits behind it.
- **One desk.** The OSAT window *is* the desk now: ⌥Space brings it up filling the screen over
  your desktop (on the Space you're on, on the display under the pointer), it stays when you
  click another app, ⌘Tab reaches it, and ⌥Space again, Esc or ⌘W puts it away and hands focus
  back to the app you were in. The separate see-through layer window is gone.
- **Every room is a pop-out.** Notes, Map (with a Board / Sky switch), Ask, Files, Today's page,
  Calendar, Habits, Reflect, Money, Projects, Browser, Terminal and Settings all open as glass
  windows on the desk that you can drag, resize and stack. Esc closes the top one.
- **The dock** is the one from the window (Desk, Notes, Map, Ask, Files, Tools, Find, Look,
  Capture) with the layer's app launchers beside it; right-click an app to take it off.
- **The quick chat (⌥⇧Space)** stays exactly as it was.
- **Removed:** the room sheets, the wallpaper choice (Lake / Moss) and the moss picture, the
  saved window size (the desk is always the screen), "Open in window".
- **After Nate tried it (Sep 27):** "overlapping issues with the new opaqueness ... looks tacky",
  "condense down the part that says note, next step, ask, search", "resizing an opened tool
  should adjust whatever is within that box", "it should not appear right on top of the middle
  of the screen as that is where you leave thoughts".
  - Rooms, menus, dialogs and toasts are solid now; nothing on the desk shows through them.
  - The four verbs moved into the line as one small switch (the chosen one says its name); the
    pill at the top, the "new chat" button, and Find and Ask on the dock are gone (Ask's room of
    chats is under Tools and ⌘4).
  - Rooms open beside the line, one each side on a wide screen. When there isn't room beside it,
    the room opens in the middle and the line rises to the top of the desk and stays above the
    rooms, so there is always a place to leave a thought.
  - Every room lays itself out for its own pop-out (container queries), so shrinking one reflows
    it instead of cutting it off.

### Phase 10: A living desk (merged, PR #12)
- **One line for everything:** type, and a drawer offers Save as a thought (Return), Ask the AI
  (⌘Return), Add to Next (⌥Return), then matching notes, files, folders and rooms. ⌘K and ⇧⌘N land
  in it; the old palette and capture dialog are gone.
- **Widgets open up** into their room from where they sit; a tray adds Focus, Habits and "From
  before"; Now playing opens a bigger player.
- **Incognito** (going under): OSAT with the internet off, checked by a fence test and the Mac
  end-to-end test. (Phase 11 turned it into the scratch page.)

### Phase 11: Nodes (merged, PR #13)
Nate, Sep 28, with photos of his five piles of paper stickies: nodes in a ranked row, "Expanded"
ones with sorted stacks (#IDEAS) above and a pile to sort below; "the sky view on top, then the
OSAT layer, then the temporary/incognito window"; stickies left on the desk; "make map a part of
notes"; clean light/dark, no brown or orange; Esc must never hide the desk.
- **Three layers.** The **Sky** above the desk (⌘3, the dock's Sky, ⌥⌘↑, or a sticky held at the
  top of the screen), the **desk**, and **Incognito** under it (⌥⌘↓, ⇧⌘U): a blank scratch page,
  offline. Esc comes back to the desk from either and never puts the desk away (only ⌥Space/⌘W).
- **Nodes are folders; branches are folders inside them; stickies are notes.**
- **The Sky is one whiteboard** (Nate, Sep 28 evening: "more animated and alive… a whiteboard like
  canvas so infinite scrolling"; it replaced the row, the laid-out view and Stars). Every node is a
  card you can put anywhere; drag the board or two-finger scroll to look around, pinch or ⌘-scroll
  to zoom, double-click it (or New node) to start a node there. Numbers follow the cards left to
  right. Click a card to open it in place: its branches as lanes (**Across**) or columns (**Down**,
  in its menu) and its stickies to sort; a card that grows slides its neighbours aside.
  Double-click flies to it. Far out, names are written large and insides fade. Linked nodes are
  joined by a flowing line, and a node a note @mentions by a dotted one. Unsorted waits on the far
  left; "Line them up again" (right-click the board) puts every node back in a row. Alive but
  calm: a slow accent glow drifts across the sky, resting cards breathe, lines flow, new cards
  spring in (none of it with Reduce motion). **Help me sort** suggests a branch for every sticky to
  sort (a matching #tag, shared words, then the AI on this Mac, which may propose new branches);
  nothing moves until ticked.
- **@ files a note from where you write it.** `@Garden` in a note, a sticky or the desk's line puts
  it in that node; the longest node name wins (`@Project Direction`), `@Garden/Ideas` is a branch,
  and a new word makes the node. The first @ is where it lives; any other @ links it (the node
  lists it under "Mentioned in"). In Notes, typing @ lists nodes and branches and offers a new
  one; the note is filed when writing ends. The line says "Save to Garden · makes Mom" before
  Return, then "Put in Garden · Undo" (Undo also takes away nodes it made). Renaming a node
  rewrites its @mentions.
- **Stickies on the desk.** A thought saved in the line lands on the open desk; a double-click
  writes one there; a note on the right-hand shelf drags out onto the desk. Drag a sticky onto a
  node on the shelf to file it, onto the dock's Sky (or the top of the screen) to take it up;
  resize from the corner; everything snaps to a grid unless turned off. Right-click the desk:
  New sticky, New node, Clean up, Snap to grid, Icon size, what the right side shows, Look,
  Add a widget, up and down. The shelf shows nodes as little piles.
- **Incognito is the scratch page:** blank until you start, your stickies wait there, and the
  pill makes the page a node (or puts it into one, to sort or as a new branch).
- **Project Direction:** OSAT's own plan, seeded once as the first node (Done / Now / Next /
  Later / Questions).
- **The look:** neutral light and dark greys, SF Pro Rounded headings, and the Mac's own accent
  colour (System Settings → Appearance) instead of the browns and orange; stickies stay bright
  paper in both looks. Pop-outs can fill the screen (double-click the bar).
- **Removed:** the freeform Board (the desk and the Sky replace it; `sorter` data is untouched).
- **Data:** schema 3 (folders: rank, colour, links, layout, `at` on the board; notes: rank, colour,
  `kind: 'scratch'`).
  Nothing is rewritten; an older OSAT refuses the data instead of dropping the new fields.
  Where stickies lie on the desk and the scratch page is per Mac (`places`), like widgets.

### Phase 12: Make it simple (merged, PR #14)
Nothing new to learn; fewer words and fewer ways to do the same thing. "Simple and for the
people": when two options fit, the one a person understands without an explanation.
- **One word per thing**, everywhere: sticky, note, node, branch, Unsorted, Delete, Move to,
  New node / New branch, Write a sticky, Color. Node cards show names only, never numbers.
- **One way for things to relate**: nesting (Move to, drag) and @mentions. "Link to" and each
  node's Across/Down layout are gone (old links and layouts stay in the data, unused).
- **@ only links** (schema 4): an @ points at a node by id (`refs` on the note). It never files
  the note, never makes a node from a typo, and renaming a node changes nobody's words.
- **Help me sort** without the AI: matching #tags and shared words, one plain line per branch
  ("These stickies look like they belong in Ideas") with Move and Dismiss.
- **Import** in the Sky: one node file (JSON) is one new node; a taken name gets "2".
- **Projects fold into nodes** (schema 4, `projectNodes`): each project is a node of the same name
  with its summary, site, folder and status as stickies. The projects themselves are kept.
- Reflection lives only in the Journal; Appearance moved from the dock into Tools (→ Settings).
- Incognito's menus speak the same words (one Move to); its redesign as Offline mode is next.
- **Fewer controls** (from a read-through of every menu): the desk's right-click holds New sticky,
  New node, Clean up and Icon size (stickies always snap; the look lives in Settings). A sticky's ×
  always means Delete, with Undo; "Take off the desk" is in its menu. Settings has three tabs:
  General (shortcuts, keys, the look), AI, and Data (backup, Obsidian, iPhone, about). Deleting a
  habit or a chat, and restoring a backup, offer Undo. The Mac menu says Go Incognito / Leave
  Incognito; the Journal's tabs are Today, Evening and Earlier. Calendar no longer sends events to
  Google or Outlook. The old boards stop updating in the background.

### Phase 12b: Offline mode (merged, PR #15)
Incognito stops being a place under the desk and becomes a switch: **Offline**.
- **The same privacy:** the one `under` flag and `desktop/under.cjs` still do all the work: nothing
  but this Mac answers (LM Studio on loopback still does), browser tabs sleep, downloads (the AI's
  too) pause and resume, the iPhone link pauses, the menu-bar icon is a moon.
- **The switch:** at the end of the line (a crossed-out wifi), the menu-bar menu's "Offline"
  checkbox, Go Offline / Go Online in the Go menu (⇧⌘U), and "Offline" in ⌘K. While it's on, a calm
  "Offline · nothing leaves OSAT" sits under the line. The desk and its rooms stay where they are.
- **What waits:** Browser, Terminal and Now Playing say "Offline: … waits until you're back online";
  so do downloading an AI size, opening a file in another app, app launchers and the iPhone link.
  Files on this Mac still list, show, Quick Look and search, so the desk's Desktop stays.
- **Captures:** what the line saves offline is an ordinary sticky on the desk, `source: 'Offline'`.
- **Gone:** the page under the desk (`Under.jsx`, `under.css`, its ink, pill and menus), the dock's
  Incognito button, ⌥⌘↓ to go under, and "Come up". Schema 5 makes every scratch sticky an
  ordinary sticky in Unsorted, words, colour and dates kept.
- **Open questions answered by default:** Offline remembers itself across restarts (as Incognito
  did: safer than silently going back online), and Ask's row stays (it only ever talks to this Mac).

### Phase 12c: The roadmap inside OSAT (in review, with Phase 18 in PR #18)
Tools → Roadmap (and "Roadmap" in ⌘K and the Go menu) opens this page, read-only, in a pop-out.
It is this file, built into the app, so it is always the plan the app was built with.

### Phase 15: Paper in (in review)
Nate's goal: scan something at the printer, walk over to the Mac, and a new node is waiting, already
sorted, to look through and rearrange.
- **One folder for paper:** Settings → Data → Scans → "Choose the scans folder" (it offers Google
  Drive's `From_BrotherDevice` when Google Drive for desktop is on the Mac). The iPhone uses the same
  folder: Files → ⋯ → Scan Documents → Google Drive → From_BrotherDevice. Scans already there are
  left alone; nothing in the folder is moved or changed. `desktop/scans.cjs` watches it (fs.watch plus
  a look every 30 s, since a streamed Drive folder may not say), knowing each scan by size and date.
- **Reading, on this Mac:** `extractText` (mac-files) now reads a PDF with no words in it, and
  pictures, through Vision (Live Text's engine; it reads handwriting), up to 10 pages. Ask gains it too.
- **Sorting, on this Mac:** the built-in AI answers in a fixed JSON shape (a grammar from a JSON schema,
  `schema` in `chatStream`): a name, branches, sub-branches, stickies, and an event on any sticky that
  names a day. It knows the nodes there are, so it can @ them. Plain code then folds a sticky whose words
  an earlier one holds, drops impossible dates, moves a year long gone (a misread) to the next time that
  day comes, and distrusts an answer that left out half the scan. Without the AI (or distrusted), it is
  one sticky per paragraph. A `.json` node file (what the old agent made) goes straight in.
- **Note or node:** a scan with one sticky is one sticky in Unsorted; more is a new node in the Sky
  (`importScan`). Main counts a scan done only once the desk has imported it.
- **Arrival:** "New from a scan: “…” · Show me" stays on the desk until the Sky is opened; Show me
  flies to the node and opens it.
- **Dates:** schema 6 lets a sticky carry `ask: { event: { title, date, time } }`. Opening its node
  shows "“Wedding” is on Mon, Oct 5, 9:00 AM. Add it to your Calendar?" with Add to Calendar (Undo) and
  Not now. No time written means 9 in the morning.
- **Tried for real:** a nine-sticky test page through the Deep model: three branches, the florist twice
  folded into one, "by Friday" became Oct 2, "dentist oct 14 3pm" an event at 3 PM (~20 s).
- **Not yet:** checking a scan against stickies already in other nodes; a Scan button inside the iPhone
  app (parked).

### Phase 16: Clear nodes (in review, stacked on Phase 15)
Nate (Sep 28): "I look at the nodes and the view but I'm confused on how it really works… it should
be usable and understandable to anyone of any age." What confused, and what changed:
- **Everything looked like a sticky.** Branch names sat on the same coloured paper, the same size, in
  the same rows as the stickies. Now only stickies are paper; a branch is a label: a dot of its colour
  and its name.
- **"Branch" promised a tree and showed a table.** An open node is now drawn as a tree: a line down
  the side with a turn into each branch, and a branch's own branches on a line under it (no more "↳").
  A closed node lists its first three branches the same way.
- **Two names for "not sorted yet".** Inside a node the loose row said "STICKIES" (everything is a
  sticky). Now it's "Not in a branch yet", shown first and only while there are some; a node with no
  branches just shows its stickies. Unsorted on the board says "Stickies in no node yet".
- **Sub-branches couldn't be made in the Sky.** "New branch inside" (a branch's menu), and a branch
  dropped on another branch's name goes inside it. "New branch" is in the node's menu too.
- **Rename in a branch's menu did nothing** (only a double-click worked). Fixed.
- **Nothing explained it.** "How the Sky works" shows once per Mac (a sticky is one thought, a node is
  a topic, branches group a node's stickies; new stickies wait in Unsorted), and again from the ? by the
  zoom or the board's menu. The hint at the bottom follows what you're doing, and an empty node says
  what to do first.

### Phase 17: Make it yours (merged, PR #20)

- Backdrops in Settings → Appearance: Your desktop (default), Sonoma (the promo's), Dusk, Sea, Meadow
  (`settings.backdrop`, painted on `.overlay-surface`).
- About you (Settings → AI): a few plain lines the AI reads before every answer (`settings.aboutMe`,
  passed to `systemPrompt`). OSAT's "soul file", in plain words.
- The Browser sits on the dock as "Web".

### Phase 18: Bots in (in review, PR #18)
Nate's words: "I want Muse to be able to upload nodes to the application that I can open up inside
OSAT. That is the whole point." And bigger: OSAT as Muse, and a tool that makes AI easy for anyone.
Everything for it lives in one Settings section, **Bots**: every model and privacy setting in one
clearly labelled place, ready for Phase 13c's switchboard to show what leaves the Mac.
- **The drop folder (the must-have).** A node file saved in `~/Documents/OSAT Nodes` becomes a node
  in the Sky a few seconds later, marked **New** (a quiet badge until it is first opened), "from
  Muse" when the file says so, and the file moves to `Added`. Nothing is deleted: a file OSAT can't
  read moves to `Set aside` and Settings says why. It works offline. The format is the Sky's Import
  (JSON) or Markdown (`# node`, `## branch`, list items are stickies, front matter names the
  source); the Sky's Import takes Markdown too now. The same file saved twice makes one node.
  Settings → Bots has the folder, Show in Finder and **Copy instructions for a bot**. Muse for Mac
  can write files there (Full Disk Access, or Documents).
- **Packed nodes.** A file with only a name and a summary arrives packed. **Unpack with AI** (the
  chosen model suggests branches and stickies, with Undo) or **By hand**; the summary, and the file
  in Added, always stay.
- **Cloud models.** Next to the AI on this Mac (still the default): pick a provider (DeepSeek,
  OpenAI, xAI, OpenRouter, Mistral, Groq, or any other that works like OpenAI), paste the key, and it
  answers. OSAT checks the key by listing the provider's models; a bad key gets one plain line. Keys
  live in the macOS Keychain, never in a file or a log. Beside each key: questions, tokens and a
  rough cost, with a link to the exact bill. The chosen model answers the line, Ask, Help me sort
  (it is asked about the stickies matching words couldn't place) and Unpack with AI; offline
  it steps aside and the AI on this Mac answers. Ask says where an answer comes from. Each provider
  has a `kind`, so Anthropic-style providers can follow.
- **Scans** come in through Phase 15 (Paper in), sorted by the AI on this Mac. This phase first
  brought its own scan intake; it was dropped when Phase 15 merged, so one folder never has two
  watchers. Using the chosen cloud model for scans is a later choice for Nate.
- **A Timeline in the Roadmap room**, read from this page's Status table, so they never disagree.
- **The OSAT connector (lean).** An MCP server on this Mac only (127.0.0.1), off until turned on,
  with a key in the Keychain that can be reset: list nodes, read a node, add a node, add a sticky.
  Every change goes through the store (the windows, sync, and Undo in Settings → Bots). Setup lines
  for Claude Code, Claude Desktop (through mcp-remote) and other apps.
- **Schema 7:** a node may be `packed`, `fresh` (New) and say where it came `from`.
- **Questions for Nate:**
  - Muse's custom connectors run on Meta's own computers, and they can't reach a connector on this
    Mac. The drop folder does the job meanwhile. A public address (the DigitalOcean droplet, say)
    would let Muse use the connector too, but then something would live on the internet, which
    breaks "everything stays on the Mac". Nothing has been set up; it's Nate's call.
  - Phase 15 now makes a node from each scan. When it looks right to Nate, the old scan → Word doc
    step can go; nothing in that flow was changed.
  - The line's row still says "Ask the AI on this Mac" when a cloud model answers. The line belongs
    to the Phase 13 work: its models carry `offline: false` and `where` for it to say so.

### Phase 19: OSAT's own bots (planned)
OSAT becomes Muse too, and leans toward business and customer management over time.
- **A Bots room in the dock**, like Muse's list: each bot with a face, its last message, and groups.
- **The first bots:** a customer manager, a follow-up bot, an Inbox sorter (files Unsorted, with
  Nate's OK) and a research bot.
- **What they can do:** read and write notes (through the same store and Undo as the connector), run
  on a schedule, draft email and messages (always asking before anything is sent), and use the web
  and Mac apps. They use the model chosen in Settings → Bots; what leaves the Mac says so there.
- **People cards** and **a morning page** (from The wow below) grow out of the same bots.

### The wow (Sep 28): what makes OSAT stand out
Raycast launches things, Notion and Mem keep notes, Rewind remembers. OSAT is all of it in one
calm, private place on the Mac, with bots feeding it.
- **The line is the launcher (13).** One key from anywhere (Caps Lock as Hyper), then type: `ss`
  opens Spotify, a file, a note or an app; `@Jordan` shows everything about Jordan; `v` is the
  clipboard; `2*49` answers in place; `>research best CRMs` hands a job to a bot. Tab for actions.
- **Quick search that feels like Raycast (13, first).** Nate's words: "No thought needed, just
  straight to work." One hotkey from anywhere (Settings can let it replace Spotlight's ⌘Space)
  opens a small bar; typing opens the full view: results on the left, a big preview on the right
  (the file, the image, the copied text), the details under it (where, kind, size; for a copy,
  which app and when). Return does the obvious thing (Open; for a copy, Paste into the app you were
  in); ⌘K lists every other action (Show in Finder, Copy path, Ask about it, Add to a node, Pin,
  Delete). Files (Spotlight, recently used first, filter by kind) and Clipboard History (Today /
  Yesterday; text, images, links; filter by kind) come first, then apps, notes and nodes, a
  calculator, emoji, quicklinks (a web address with the search in it) and window layouts.
  Settings → Launcher lists each one to turn on or off, with its own hotkey or keyword, and
  compact or expanded. The clipboard stays on this Mac, skips what password managers mark as
  concealed, and can be paused.
- **A clipboard that files itself (13).** Every copy kept privately on this Mac, searchable, pins
  for snippets. Copy something that looks like a customer's email or phone and OSAT offers
  "Add to Jordan?".
- **Bots in (18).** Nate's words: "I want Muse to be able to upload nodes to the application that
  I can open up inside OSAT. That is the whole point." First a folder OSAT watches
  (`~/Documents/OSAT Nodes`: a node file saved there appears in the Sky, reusing Import a node
  file and the iPhone Inbox's watcher), then a connector on this Mac only (MCP, with a key Nate
  turns on and can reset in Settings → Bots) to list, read and add nodes and stickies. If Muse
  can only reach an internet address, ask Nate first: that breaks "everything stays on the Mac".
- **Capture anywhere (20).** Select text in any app, one key, it's a sticky, and it remembers where
  it came from (the page, the email, the file): "you saved this from Jordan's email on Tuesday".
  The browser's clipper, grown to the whole Mac. Hold a key and talk; it's written on this Mac.
- **OSAT's own bots (19).** A Bots room in the dock like Muse's list (faces, last message, groups):
  a customer manager, a follow-up bot, an Inbox sorter, a research bot. They read and write notes,
  run on a schedule, draft email and messages (always asking before sending), use the web and Mac
  apps. **People cards:** type a name, see one card: notes, last contact, what's owed, the next
  step, the follow-up already drafted. **A morning page:** opening the desk says, calmly, what's
  due, what the bots did overnight and what waits in Unsorted. This is where business and
  customer management starts, without building a whole CRM.

### Nate's thoughts (Sep 29): files, drag and drop, nodes that become projects
Nate, in his words: "I want people to be able to find their files", "the finder or files section to
allow the user to reorganize all the files on their computer", "the user themselves also need to have
an organized desktop and folder system", "dragging and dropping files… feels clunky", "click the desktop
button drag a file or right click a file and toss into the sky view", "inside a node it has its own
project management tools", "an easy visual view of that, github like: where we're at, what we've gotten
done, and what's to come", and on an editable timeline "move something more forward to see if that can
happen so I can 'rush' a feature".

What the code does today (checked Sep 29), which shapes the plan:
- **Finding** is by file name only (`files:search` → `mdfind -name`), in Desktop, Documents, Downloads
  and folders Nate added. Nothing looks inside files, and there's no "kind" or "when".
- **Reorganizing** isn't possible: OSAT can list, open, show in Finder and Quick Look, but never move,
  rename, make a folder or put something in the Bin. The safe-write guard it needs already exists
  (`resolveApprovedWritePath`).
- **Drag and drop is two different systems.** Stickies and nodes use OSAT's own (`lib/carry.js`); the
  Notes room uses the browser's old one (`draggable`); files aren't carryable at all, can't be dragged
  out to Finder or Mail, and only the Ask chat takes a file from Finder. That's the clunky feeling.
- **Nodes** hold branches and stickies only: no files, no dates, no done/not done.

It is too much for one pull request, so it becomes four phases (numbered after Phases 18–20, which were already taken), each useful on its own, in this order:

#### Phase 21: Find and tidy your files
One job: any file, found in seconds, and put where it belongs without leaving OSAT.
- **Better finding.** ⌘K and Files search look inside files too (Spotlight's own index, so it's fast
  and stays on the Mac), and understand plain words for kind and time: "pdf", "photos", "last week",
  "yesterday". Results say where each one lives and open on Return. Still only in the places OSAT may see.
- **Reorganize from Files:** New folder, Rename (in place, like Finder), Move to… (the same "Move to"
  menu words as stickies), and Delete, which puts it in the Mac's Bin, never erases, with an Undo toast
  that brings it back. Several at once (⌘-click, ⇧-click, drag a box). A list view beside the icons.
- **One drag system everywhere.** Files join `carry.js`: drag a file onto a folder (in Files, the path
  bar, the sidebar or the desk) to move it; hold ⌥ to copy. Drag a file out of OSAT to Finder, Mail or
  any app (`webContents.startDrag`), and drop files from Finder onto a folder in OSAT to move them in.
  The Notes room moves off the old system too, so every drag looks and feels the same: a ghost under
  the pointer, the place that takes it lights up, Esc puts it back.
- **Safety stays:** nothing outside the approved places, no apps or scripts run, Undo for every move,
  rename and delete, and a calm line if a move fails ("That file is open in Pages. Close it and try
  again.").

#### Phase 21b: A tidy desk and folders (OSAT helps, Nate decides)
- **Tidy my Desktop.** One button on the desk's Desktop shelf. The built-in AI looks at the names (and,
  for a few, what's inside) and proposes a plan: "12 screenshots → Pictures/Screenshots, 4 invoices →
  Documents/Money, 3 installers → Bin". The plan is a list Nate ticks through: Do it, Skip, or change
  where each goes. Nothing moves until he says so, and the whole tidy has one Undo. The AI step runs in
  the main process with a fixed answer shape, like scans do, in small batches.
- **A folder layout to grow into (optional):** OSAT offers a simple home layout (for example Projects,
  Money, Home, School, Archive) and can make it. Nodes and folders can then match: "Make a folder for
  this node".
- **Keeps itself tidy:** a quiet "Anything on the Desktop older than 30 days goes to Archive/2026-09?"
  offer, off by default, never a nag or a count.
- Same rule as Tidy Unsorted in "Later": AI proposes, Nate accepts or declines each.

#### Phase 22: Files in the Sky
- **Toss a file up.** Drag a file from the desk's Desktop shelf, from Files or from Finder up into the
  Sky (the top edge, or the dock's Sky button, like a sticky today), or right-click → "Send to the Sky".
  It lands in Unsorted as a **file card**: its thumbnail and name, not a copy. Drop it on a node like a
  sticky. Double-click opens it; right-click shows it in Finder.
- **A node can have its own folder.** "Link a folder" on a node: the open node then shows that folder's
  files in their own row, and new files dropped on the node can be moved into that folder (asked the
  first time). Rename or move the folder in Finder and the link follows it (a macOS bookmark, not a path).
- The data: file cards and a node's folder are new fields, so this is **schema 8** (with a migration
  and a test). A file that's gone shows calmly as "Moved or deleted: Find it" instead of breaking.

#### Phase 23: Nodes become projects
Turn on "Track it" for any node, and it gains the view Nate described: where we're at, what's done,
what's to come.
- **Three lanes:** Done, Now, Next (and Later, folded away). A sticky or branch can be moved between them
  by dragging; a checkmark marks it done. Nothing changes for nodes that aren't tracked.
- **The timeline.** Built on the Roadmap room's Timeline (Phase 18), not a second one: the same calm
  line, drawn from a tracked node's steps (branches or stickies with a date or an order), today marked,
  done steps filled in. Every step can be dragged along it.
- **Rush it.** Drag a step earlier and OSAT shows plainly what that means before it lands: "Rushing
  Files in the Sky to this week moves Tidy Desktop back a week" (steps can say what they wait on, and
  how big they are: small / medium / large). Let go to keep it, Esc to put it back, Undo afterwards.
  No scary warnings, just what would move.
- **OSAT's own plan as the first project.** The Roadmap's Timeline already shows this page's phases;
  tracking lets Nate rush one there too.
- **GitHub (optional, later, online only):** a tracked node can be linked to a GitHub repository, and
  its steps show their branch and pull request (open, being checked, merged). Off by default; Offline
  pauses it like everything else online.

Questions for Nate before building:
1. **Rush:** is it enough to see what moves when something goes earlier, or should OSAT also say "that's
   too much for one week" (it would need a rough size for each step)?
2. **Files in the Sky:** a card that points to the real file (the plan), or should tossing a file up
   also move it into the node's folder?
3. **Tidy:** is the Mac's Bin fine for "Delete" (always recoverable), or would you rather OSAT never
   deletes files at all?

### Nate's list (Sep 28), and where each part lands
| Wish | Phase |
|---|---|
| Nodes, branches, ranking, collapse/expand, quick view, AI sorting, Project Direction | 11 |
| The Sky as an infinite, living whiteboard; @Node in any note links to it | 11, 12 |
| Stickies on the desk, drag out of the shelf, into nodes, up to the Sky; resize; grid snapping | 11 |
| Sky ↑ / desk / Incognito ↓ as a blank scratch page that becomes a node | 11 |
| Esc never hides the desk; right-click desk menu; folders (nodes) on the desk; icon size; full-screen tools | 11 |
| Clean light/dark, the Mac's accent, no brown/orange/green | 11 |
| Hyper key (Caps Lock + a letter: V clipboard, S find files, C Chrome…) | 13 |
| Keywords in the line (type `ss` → Spotify), swappable apps (Apple Music instead) | 13 |
| The ring: ⌘ + middle-click opens quick tools around the pointer, customisable | 13 |
| Clipboard history (from Nate's Stash) | 13 |
| Window snapping like Rectangle (from Nate's WindowFlow) | 13 |
| Tools as a scrolling wheel with descriptions; a dock you can move anywhere; resizing widgets | 13 |
| Settings: online / semi-offline / offline, as a "switchboard" of apps, plugins and cloud APIs that says plainly what leaves the Mac | 13 |
| Email: Apple Mail first, then Gmail in the in-app browser, then Outlook; more connectors | 14 |
| Messages inside OSAT (beside it: macOS doesn't let one app hold another's window) | 14 |
| Photos of paper stickies read into stickies; the Brother's scans become sorted nodes | 15 |
| iPad: GoodNotes-style pages, hand-drawn mind maps, Apple Pencil Pro squeeze ring, synced | Later (parked) |
| iPhone: a document scanner (for now: Files → Scan Documents into the scans folder, which Phase 15 reads) | Later (parked) |
| OSAT's own agents/bots: a Bots room, customer manager, follow-up, Inbox sorter, research | 19 |
| Muse's bots put nodes into OSAT ("the whole point") | 18 |
| Cloud models: DeepSeek first, any provider, easy for anyone | 18 |
| A project timeline inside OSAT | 18 |
| The roadmap, viewable inside OSAT | 12c |
| Quick search like Raycast: files and the clipboard with a preview, one key, straight to work | 13 |
| A Raycast feel; business and customer management over time | 13, 19 |

### Later (after the MVP)
- Files become "Linked folders" in Notes. (Projects became nodes in Phase 12.)
- "Tidy Unsorted": AI proposes a folder, tags and links, and Nate accepts or declines each.
- Read-only Apple Calendar in Today.
- A Mac App Store build: sandbox, no terminal.

## Git workflow (Claude manages it)
- `main` always works.
- Each phase gets its own `claude/…` branch from `main` and is opened as a draft PR with a plain-English summary, a "How to try it" section and a Mac checklist.
- After Nate says "merge", Claude merges, and the next phase starts a fresh branch from the new `main`.
- Small, descriptive commits. Nothing is ever lost from history.
- Claude watches each PR's CI and fixes failures.

## Verification
- **Every PR:**
  - `npm test` (the pure models, plus the new store/overlay/catalog tests)
  - `vite build`
  - a Playwright smoke test of the web preview (screenshots of every space at 1440×900, light and dark, attached to the PR)
  - from Phase 1, an Electron end-to-end test under xvfb (store round-trip, two windows, capture while the main window is closed)
  - the macOS CI smoke test: launch the packaged OSAT.app with an isolated data folder, then check the store round-trip, that the overlay window exists, and that node-pty can spawn.
- **Checked by Nate on his Mac from the PR's DMG** (short checklist per PR):
  - ⌥Space over a full-screen app and on another Space
  - the previous app keeps focus after Esc
  - multiple displays
  - vibrancy in light and dark
  - the hotkey-conflict path
  - Metal model speed
  - first-run download.
