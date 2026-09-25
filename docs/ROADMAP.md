# OSAT roadmap — from sprawling prototype to a calm Mac MVP

## Context
OSAT Field is Nate's personal, local-first "second brain" Mac app: React 19, Vite 6 and Electron 43, about 10.5k lines of JS and 7.5k lines of CSS, with 82 unit tests covering only the pure data-model code. It was copied and redesigned five times (NateOS → OSAT → OSAT V2 → OSAT Field → "OSAT Field copy"). Each pass layered new rooms, docs and compatibility code on top of the last. It was just pushed to GitHub (`SouthernSimp/Claude-OSAT-Cloud`, `main` = one "Initial import" commit).

Nate gets lost in it:
- about 19 rooms
- the list of rooms written out in about 15 places
- settings and sub-menus with no clear home.

He wants an MVP **for himself**: calm, anxiety-reducing, good-looking and unique. It should center on a **summon-anywhere overlay** (inspired by lykn.io, but private and local), with **local AI models that download on first launch**. Mac comes first, phone capture later, the App Store eventually (he has an Apple Developer account). He is new to GitHub, so Claude runs the repo.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Foundation and cleanup | Done, merged (PR #1) |
| 1 | Final data shape and one source of truth | Done, merged (PR #1) |
| 2 | The overlay (LYKN-style layer with pop-outs) | Built, in PR #2 — waiting for Nate's try |
| 3a | One navigation, Settings, Tools | Next |
| 3b | One Today | Planned |
| 4 | Local AI that sets itself up | Planned |
| 5 | Visual polish | Planned |

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

### Phase 3a: One navigation, Settings, Tools
- `src/lib/spaces.js` is **the one definition** of spaces, tools, shortcuts and labels. The top bar, ⌘K, the keyboard handler and the Mac menu bar (sent over IPC) all read from it. Delete the nav lists in `modules.js`, `FieldChrome` TABS/MORE/DOCK, `ROOM_KEYS` and the menu lists in `main.cjs`.
- The window's top bar has Today · Notes · Map · Ask, then a Tools menu, Search (⌘K) and New.
- The Settings sheet has five sections. The Obsidian export moves to Data, along with Export/Import in the new format and "Show data folder".
- The command palette covers every space, tool, setting and action.
- Map gets a Board / Sky toggle that renders the existing `FieldSky` in place.
- Retire the in-window desk home, the wallpapers, the Focus timer and `field-sample.js` (it holds personal sample content). Delete their CSS in the same PR.

### Phase 3b: One Today
- A date header with a month picker, reusing the grid from `Calendar.jsx`.
- **Next:** at most 5, the rest collapsed. Unchecked steps from earlier days show as a one-tap "bring forward" offer.
- **Schedule:** that day's `calendar.events`.
- **Page:** the day note, which serves as the journal.
- **Habit chips:** from `daily-practice.js`.
- **Three optional evening prompts:** answers are written into the day note, and "next honest step" becomes a `- [ ]` on tomorrow's page.
- **Notes:** Unsorted sits first in the sidebar (a soft dot, no count). Rows offer Move… / Keep / Add to Today / Trash with Undo.
- **One note editor** (`NoteEditor`), used everywhere. Map cards and Today's page embed it.
- Delete the Journal, Reflection, Habits, Inbox and Calendar room views and their CSS.

### Phase 4: Local AI that sets itself up
- `desktop/ai/runtime.cjs` runs in an Electron `utilityProcess`, so a model crash can't take down the store. It has three providers:
  - **llama:** `node-llama-cpp`, Metal
  - **openai-compatible:** LM Studio or Ollama on loopback. This replaces the three copies of the client.
  - **mock:** used in the cloud and in CI.
- `desktop/ai/catalog.json` has three tiers (Light / Balanced / Deep), each with url, sha256, size and minimum RAM. `pickTier(os.totalmem())` is tested. The exact models are chosen at build time and license-checked.
- Downloads are resumable and checksum-verified, with a free-disk check. Progress shows in the menu bar and in Settings → AI.
- **First run** takes three calm steps: what stays private → your hotkey (try it) → AI size, with the recommended tier preselected. The download runs in the background while the app is fully usable.
- **Ask everywhere:** Ask comes to the overlay. The full Ask space auto-picks relevant notes through Find and shows them as removable chips ("Using 3 notes"). AI actions are always accept/decline cards.
- Add `asarUnpack` entries for node-llama-cpp.

### Phase 5: Visual polish
- One design language: the glass overlay plus a calm window.
- Tokens only: remove the alias tokens, fold `board.css`'s tokens into `tokens.css`, cut the type scale to about 8 steps, add z-index tokens, reduce the breakpoints.
- Empty states that teach one step. Undo toasts everywhere. Reduced-motion-safe transitions.
- Target: CSS down from about 7.5k lines to about 4k.

### Later (after the MVP)
- Projects become folder properties, and Files become "Linked folders" in Notes.
- "Tidy Unsorted": AI proposes a folder, tags and links, and Nate accepts or declines each.
- Read-only Apple Calendar in Today.
- A Mac App Store build: sandbox, no terminal.
- Phone capture (an iCloud Drive inbox or a Shortcut), then a native iPhone app with a model picker at install.

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
