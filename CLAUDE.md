# OSAT — notes for Claude

OSAT is Nate's personal, private "second brain" for the Mac. It is a calm layer over the
Mac: press a hotkey anywhere to drop a thought, find something or ask your own notes,
and open the window to sort and think. Everything, including the AI, stays on the Mac.
It is built for one person first; the App Store and a phone companion come later.

The direction and the phase-by-phase plan live in [docs/ROADMAP.md](docs/ROADMAP.md).
Read it before any substantial change and keep it current when a phase lands.

## Resume checkpoint — October 3, 2026

Core workflow improvements are on `codex/core-workflow-20261003`, based on
`codex/osat-ai-model-controls` (PR #39), in the isolated checkout
`/Users/nate/Desktop/Projects/OSAT V2/work/osat-core-improvements`.
Browser review is running at http://127.0.0.1:5232/ with synthetic preview records.
Sky has a dismissible/searchable Unsorted drawer, topic/branch/note search,
readable topic focus, distinct topic surfaces, and explicit example creation.
Notes have wrapping titles, focused writing, save status, and permanent-trash
confirmation. Idle capture stays behind open rooms; ⌘K still summons it.
Rejected saves retain pending edits; a temporary validated journal restores them
after reload and offers retry/export. Browser acknowledgments wait for IndexedDB.
AI conversations retain workspace/topic/no-notes scope. Focused context comes
before the Unsorted summary; AI unpack is an editable proposal with explicit
acceptance and Undo that keeps subsequently edited notes.

Local validation: 483 unit checks, Vite build, browser writing/checkbox/reload
recovery, drawer filtering/camera stability, branch search and 600px responsive
checks. See `docs/CORE-WORKFLOW-20261003.md` for details and acceptance limits.
No native application tests, installed-app changes, real inference, or Laya
installation were performed. Merge/install remain for Nate after review.

### Previous checkpoint — October 2, 2026

Continue the AI controls review from `codex/osat-ai-model-controls`. The verified
continuation checkout is
`/Users/nate/Documents/Codex/2026-09-30/referenced-chatgpt-conversation-this-is-an/work/osat-continuation`.
This is the source corresponding to the current installed OSAT; the old V2 folder
is a separate prototype. `AGENTS.md` records Nate's accepted model-management decisions.

Phase 4b adds per-chat model choice/reply attribution (schema 11), sequential
install-all downloads, startup loading off by default, explicit load/unload and
session retention, native memory/reload-cost review, and Free AI memory in Ask,
the floating chat, and the menu bar. Manual unload blocks background reload;
queued/running jobs and questions arriving during confirmation stay protected.
`npm run test:ai-models` exercises isolated windows with practice inference.
`npx electron scripts/ai-memory-check.cjs /absolute/path/to/catalog-model.gguf`
checks real inference/unload/reload without opening notes or downloading a model.
The installed `/Applications/OSAT.app` and its workspace have not been upgraded.
Merge and install remain for Nate's instruction after review.
Validation completed: 468 unit checks and the Vite build passed; the existing
Electron regression and isolated three-model UI/persistence flow passed; the
downloaded Balanced model answered, exited on unload, and reloaded on the next
question through Metal. All-three simultaneous real inference was not tested.
Nate then requested no more Mac application tests on his computer. Continue with
code-only checks or CI unless he explicitly asks for native testing again.
The Apple Silicon DMG is saved locally at
`/Users/nate/Downloads/OSAT-AI-model-controls-2026-10-02-arm64.dmg`.
The shared node_modules symlink caused dependency omissions in electron-builder;
the local package uses complete production dependencies from installed OSAT
(the unchanged node-llama-cpp 3.21.1) with this branch's desktop/shared/built UI.
Packaging in the cloud-backed Documents folder added signing-disallowed Finder
attributes, so the complete bundle was copied without attributes to /private/tmp,
ad-hoc signed with the existing entitlements, and placed in a DMG with an Applications
shortcut. Static signature/content and final copy checks passed. This package was
not launched after Nate's request to stop native tests, and has not been installed.

### Consolidation checkpoint — September 30, 2026

Continue from `codex/finish-claude-osat` in `SouthernSimp/Claude-OSAT-Cloud`.
The active Claude source is `/Users/nate/Desktop/OSAT Field copy`; the separate
`Desktop/Projects/OSAT V2` copy is not this repository. Original worktrees and local edits
were preserved before consolidation, with recovery refs under `recovery/2026-09-30/`.

Combined: PR #34 connectors, desk stacks and focused mind map; its uncommitted first-run
tour; uncommitted Raycast-style Settings and Phase 13b; PR #35 Desktop tidy; PR #36
Mac Calendar and Reminders. Finished the top Sky entry, all-tools menu, native emoji picker,
Desktop shelf/Find tidy entries and Mac privacy usage strings. Quick search cancels pending
copy-dismiss timers when someone keeps using it. Native calendar writes report failed saves.
Nate explicitly authorized finishing and merging. Earlier PRs #29, #30, #32 and #33 are merged.

Paused Projects, tags/date words and Stratosphere prototypes remain separately preserved;
they are not part of this continuation. Later Phase 27 combine/split operations, “Make a folder
for this node”, and the remaining Mail/Messages connectors remain future roadmap work.



## Working with Nate

- Nate is new to git and GitHub. Claude runs the repo: one branch and one draft pull
  request per phase, with a plain-English summary, a "How to try it" section and a short
  Mac checklist. Nate tries the DMG that CI builds and says "merge"; then Claude merges.
- Explain in plain words. Nate would rather see the result than the internals.
- Display the name `OSAT` only and never spell out the letters.
- Before finishing a working session, commit and push completed changes to GitHub.
  Keep this resume checkpoint and the roadmap current so Nate can switch between
  Claude and Codex without losing progress. Leave merging for Nate's instruction.

## Calm rules (apply to every screen)

1. One obvious primary action per screen.
2. Nothing is lost: prefer an Undo toast to a scary confirmation.
3. No nagging counts or red badges.
4. Esc always backs out; ⌘K always finds anything.
5. Every space has the same anatomy and comes from one navigation definition.
6. Plain words: "Unsorted", not "Inbox", "records" or "canonical".
7. Saving is invisible unless it fails; then say so calmly with a way forward.

## Commands

```bash
npm ci                 # install (ELECTRON_SKIP_BINARY_DOWNLOAD=1 on Linux)
npm test               # unit tests (node --test tests/*.test.mjs)
npm run build          # vite build → dist/client
npm run test:ui        # opens the built preview in Chromium, visits every room,
                       # fails on page errors, screenshots → test-results/ui/
npm run test:e2e       # launches the real Electron app (needs a display: xvfb-run -a on
                       # Linux; run `node node_modules/electron/install.js` once first).
                       # OSAT_AI=mock inside it: a practice model answers, nothing downloads
npx electron . --osat-self-test[=model.gguf]   # the AI engine (and a model) work? no notes opened
node scripts/keychain-check.cjs    # Mac only (CI's mac job): a key in and out of the real Keychain
node scripts/scan-read-check.cjs   # Mac only (CI's mac job): words read off a PDF, a picture, a picture PDF
npm run ios            # opens the iPhone app in Xcode (needs Xcode's license accepted and
                       # `brew install xcodegen`); see docs/IPHONE.md
npm run dev            # web preview at http://127.0.0.1:5173 (its own browser data)
npm run start:mac      # build and run the Electron app from source (data: "OSAT Dev")
npm run install:mac    # build the DMG and install /Applications/OSAT.app (macOS only)
```

The cloud container is Linux: tests, the build, the web preview and Playwright
screenshots work there; the Electron app, the global hotkey, vibrancy and the Mac menu
bar can only be checked on a Mac (the CI `mac` job builds and launch-checks the DMG).
The iPhone app is built and screenshotted in the simulator by the CI `iphone` job (parked: it
runs only on pushes to main and by hand, so it shows as skipped on pull requests); on
Nate's Mac, Xcode's license isn't accepted yet, so don't try to build iOS locally.

## Architecture today

- `desktop/` — Electron main process (CommonJS).
  - `ai/`: the AI that sets itself up. `catalog.cjs` (Light / Balanced / Deep: Gemma 4, pinned
    URL + size + SHA-256, `pickTier(memory)`), `download.cjs` (resumable `.part`, checksum, free
    disk), `runtime.cjs` (node-llama-cpp in a `utilityProcess`, one chat at a time, Gemma's
    thinking turned off), `index.cjs` (`createAi`: the chosen size in `prefs.json`, background
    download, engine starts on the first question and stops after 10 idle minutes; `mock`).
    Model files live in `<data folder>/models`. LM Studio still works through `local-ai.cjs`.
  - `main.cjs`: windows, menu, IPC for the store / local AI / browser / terminal (`handle`, `fail`
    and the trusted-sender checks live here and are passed to the modules that register handlers),
    the desk and the ⌥⇧Space quick chat (two shortcuts in `shortcuts`: `layer` is the desk's ⌥Space;
    menu-bar icon, app launchers, Esc routing: a panel swallows Esc, so OSAT takes it while the
    chat has focus), single-instance lock. The desk is the one main window: frameless,
    see-through with vibrancy, it fills the work area of the display under the cursor each time
    it shows (`showDesk`), comes to the current Space, and closing it only hides it (`hideDesk`
    gives focus back to the previous app); only ⌘Q quits. IPC answers the desk (`from: 'app'` is
    kept for windows that will show rooms later).
  - `files.cjs`: all of main's file access, so main only calls `createFiles` (as it calls `createBots`):
    the places and grants (`approved-files.json`), `approvedPath`/`approvedWritePath`/`sourcePath`/
    `folderPath` (a path must stay inside one), the undo tokens (`undos`, `keepUndo`), `binTrash`,
    `thumbnail` (cached; main's dock launchers use it too, as `files.thumbnail`), `readForAsk`, every
    `files:*` IPC handler, and `stop()` (grant access ends at quit). It gets `handle`, `fail`, the window
    (`mainWindow()`), `dataDir` and Electron's pieces from main; `NOT_ALLOWED` is exported because
    main's `handle` words a denied folder with it.
  - Files: Desktop, Documents and Downloads are built-in places (ids `desktop`/`documents`/
    `downloads`, macOS asks once per folder; tests set `OSAT_PLACES_DIR`, from source only) beside
    the folders Nate adds (grants). Hidden files never show; apps, scripts and installers are shown
    in Finder, never opened (`isSafeOpenFilename`). Thumbnails are Quick Look's
    (`nativeImage.createThumbnailFromPath`); `app.getFileIcon(…, { size: 'large' })` crashes
    Electron 43 on the Mac, so don't use it.
  - `mac-files.cjs`: the places, what Finder counts as one file (packages), Spotlight search
    (`mdfind -onlyin … <query>`; `inside`, `rankFound`, and `walkFind` where there is no Spotlight:
    tests and Linux) and the text Ask reads from a file (PDFKit through `osascript -l
    JavaScript`, Word/RTF through `textutil`, capped at 12,000 characters).
  - `mac-calendar.cjs` (Phase 14 step one): the Mac's Calendar and Reminders through EventKit in `osascript -l
    JavaScript` (one script, one command per run); `createMacCalendar({ handle, fail })` registers the `maccal:*`
    channels (`osatMacCalendar` in the preload). A status check never asks macOS; `allow` does, once. Reads and
    writes go to the Mac's own store; nothing enters `calendar.events`. The window's side is
    `shared/mac-calendar-model.mjs` (shapes, merging, reminder words) and `src/views/MacCalendar.jsx` (hook and the
    two panels in the Calendar room). Needs four usage strings in `package.json` `build.mac.extendInfo`
    (`NSCalendarsFullAccessUsageDescription`, `NSCalendarsUsageDescription`, `NSRemindersFullAccessUsageDescription`,
    `NSRemindersUsageDescription`). Mail, Gmail, Outlook and Messages are later steps.
  - `file-ops.cjs`: tidying (Phase 21 step 2): New folder, rename, move / copy, the Bin, all on absolute
    paths files.cjs has already checked (`sourcePath`/`folderPath`: never a root, never hidden, never
    a link); each returns `undo`, a function kept in files.cjs's `undos` map so the window holds only a token
    (`files:new-folder`/`rename`/`move`/`trash`/`undo`). A taken name is numbered, nothing is overwritten,
    a batch stops at the first failure. The Bin is `trashItem` in mac-files (osascript JXA; it reads the
    landing place through `$()`, a `Ref()` crashes osascript); off the Mac it is `<data folder>/Bin`.
    `scripts/bin-check.cjs` (CI's mac job) checks the real Bin. Step 3: `files:move-in` takes files dropped
    from Finder (the preload's `moveIn(Array.from(files), …)` turns each `File` into its path with
    `webUtils.getPathForFile`; pass an array, not a `FileList`, which the bridge empties) and `cleanDropped`
    refuses a disk, the home folder, a place or granted root, and hidden names; `files:drag-out` hands
    files to `webContents.startDrag` (icon: the cached Quick Look thumbnail) while the mouse is still down.
  - `quick-chat.cjs`: the quick chat window, a floating panel on every Space that stays where
    it's left (`chatBounds` in `prefs.json`).
  - `scans.cjs`: Paper in (Phase 15). Watches the folder chosen in Settings → Data → Scans (the Brother's
    Google Drive `From_BrotherDevice`; the iPhone's Scan Documents saves there too). Each new scan is read
    (`extractText`: Vision for scans and pictures), sorted by the built-in AI into a node file (`SCAN_SCHEMA`,
    a JSON-schema grammar via `chatStream({ schema })`), cleaned in code (`toNode`), and handed to the desk
    (`osatScans.take`/`done`), which imports it with `importScan` (one sticky → Unsorted, more → a node).
    Scans present when the folder was chosen are left alone; the folder is never changed. `scans.json` in
    the data folder remembers what came in.
  - `media.cjs`: Spotify on the desk through AppleScript (now playing, play/pause, skip).
  - `phone.cjs`: the iPhone link, off until turned on in Settings → iPhone. An `OSAT` folder in
    iCloud Drive: text dropped in `Inbox` becomes an Unsorted note (source `iPhone`) and moves to
    `Inbox/Added`; `Notes` holds a read-only Markdown copy (only files listed in its
    `.osat-mirror.json` are ever changed). Turning it off removes the copy. macOS asks before an
    app looks in iCloud Drive, so nothing touches it until the link is on. Tests set
    `OSAT_ICLOUD_DIR` (from source only).
  - `folder-watch.cjs`: the one way OSAT takes files in from a folder (`settledFiles`: settled a
    few seconds, not hidden; `watchFolder`: fs.watch plus a 30 s poll; `oneAtATime`, `moveInto`),
    shared by the iPhone Inbox and the drop folder (Phase 15's scans still watch on their own).
  - `bots/` (Phase 18, Settings → Bots; `index.cjs` wires it, main only calls `registerBots`):
    `drop-folder.cjs` (`~/Documents/OSAT Nodes`, from source `OSAT Nodes (Dev)`, tests set
    `OSAT_NODES_DIR`: a node file becomes a New node, then moves to `Added`; unreadable ones to
    `Set aside`; nothing deleted; works offline), `cloud.cjs` (cloud models: OpenAI-style providers,
    keys checked by listing models, usage totals), `keychain.cjs` (keys through `security -i`'s
    input, never argv; off the Mac held in memory), `settings.cjs` (`bots.json`: model, providers,
    usage, connector, never a key), `connector.cjs` (MCP over HTTP on
    127.0.0.1 only, Bearer key from the Keychain, refuses other Hosts and web Origins; tools in
    shared/connector-tools.mjs; each change commits through the store with its inverse for Undo).
    Main routes models in one place: `answeringModels()` (the model chosen in Bots first, a cloud
    one only while online) and `chatWith()`; the line and Ask read `local-ai:models`, so the line's
    own code never changes to switch models. A new way out of the Mac must be added on purpose to
    the fence in tests/under.test.mjs.
  - `launcher/` (Phase 13; `index.cjs` wires it, main only calls `createLauncher` and gives it `handle`, `fail`, the
    desk window and Electron's pieces; every `search:*` / `ring:*` channel is checked against the window that may ask,
    `handle`'s `from` can be a function). `search-window.cjs` (the quick search panel, ⌘⇧Space: a floating panel on
    every Space, a bar that grows to the full view; the app you were in keeps focus), `clipboard-history.cjs` (copies
    kept in `<data folder>/clipboard/`, skipping concealed types; pins, limits, Undo; OSAT's own writes go through
    `quiet()`), `apps.cjs`, `recent-files.cjs` (Spotlight's last-used dates), `front.cjs` (`lsappinfo` for which app
    a copy came from; `pasteInto` sends ⌘V through System Events, only with Accessibility), `hotkeys.cjs` (the
    launcher's own global keys: a Hyper key per source, window layouts, the ring), `snap.cjs` (window snapping
    through System Events, never OSAT's own windows), `ring-window.cjs` (the ring's panel, made on first use).
    Settings are `launcher.json` in the data folder (`shared/launcher-model.mjs`), never in `workspace.json`. The
    one way out of the Mac it adds is opening a web address in Nate's own browser (fenced in tests/under.test.mjs,
    refused offline). ⌘⇧Space is the third shortcut in main's `shortcuts` (`search`).
  - `sync.cjs`: the same switch keeps devices in step through `OSAT/Sync` (see sync-core below).
    It hooks `store.onCommit` to note every change made here (except what sync applied), keeps
    its place in `store/sync.json`, and once set up it notes changes even while the link is
    off (loaded before any window opens) and sends them when it comes back on.
  - `desk.cjs`: the desk's pure pieces: hotkeys (`validHotkey`, `hotkeyLabel`), `displayAt`,
    `deskAction` (what ⌥Space does), app launchers and where widgets were set down (`placeItem`).
  - `store/`: the workspace lives here. `index.cjs` owns the one document (via the shared
    hub), saves it 250 ms after a change, and does a final synchronous save on quit.
    `file.cjs` writes `store/workspace.json` atomically, keeps 14 daily snapshots and sets an
    unreadable file aside instead of deleting it.
  - `data-folder.cjs`: data lives in `~/Library/Application Support/OSAT` (`OSAT Dev` from source).
    An older folder without our marker is renamed aside, never read or deleted.
  - `preload.cjs`: the bridges exposed to the renderer (`osat.store`, `nateOSFiles`,
    `osatLocalAI` (models, `chatStream` → `{ done, cancel }`, and the built-in AI's status /
    choose / cancel / resume / remove), `osatScans`, `osatBrowser`, `osatTerminal`, `osatApp` (incl. the
    first-launch welcome), `osatDesk`, `osatChat`). An AbortSignal can't cross the bridge; pass
    functions. A dropped file's path comes from `webUtils.getPathForFile` in the preload, never
    from the page.
- `shared/tidy-model.mjs` + `desktop/tidy.cjs` + `src/views/TidyDesktop.jsx` — Tidy my Desktop (Phase 21b).
  The model is pure: `kindOf`, `ruleDest` (by-kind fallback), `tidyMessages` / `tidySchema` /
  `readTidyAnswer` (the AI's answer, cleaned: only menu folders, the Bin only for installers, apps never
  move), `groupPlan` / `describeGroup` ("12 screenshots → Documents/Screenshots"), the archive offer's
  `oldFiles` / `archiveFolder`. `tidy.cjs` is registered from files.cjs (`registerTidy`, given its checks,
  `keepUndo` and `ai: () => ai`): `files:tidy-plan` (moves nothing; the built-in AI in batches of 25, else the
  rules), `files:tidy-do` (the ticked groups as ONE undo token; folders are made inside Documents),
  `files:tidy-layout`, and `files:tidy-offer` / `-set` / `-later` (`tidy.json` in the data folder; off by default).
- `shared/file-query.mjs` — finding a file in plain words (Phase 21, step 1): `parseFileQuery`
  ("pdf taxes last week" → words, kinds, since; "quoted" words stay words; glue words drop only when
  a kind or time was named), `spotlightQuery` (each word in the name or inside, any kind, the day),
  `matchesFile` (the same test for `walkFind`) and `describeFileQuery` (what the Files room says back).
  `files:search` answers `{ rootId, relative, name, kind, size, modifiedAt, match: 'name' | 'inside' }`.
  The Mac CI job runs `scripts/find-check.mjs` against the real Spotlight.
- `shared/quick-search-model.mjs`, `launcher-model.mjs`, `clipboard-model.mjs`, `clipboard-offer.mjs`, `calc.mjs`,
  `window-layouts.mjs`, `ring-model.mjs` — Phase 13's pure rules, shared by main, the panel and the desk: how typed
  words are read (`readTyped`, `readLine`, keywords), how sources become one list of rows (`buildRows`), what Return
  and ⌘K do (`actionsFor`), the clipboard's kinds, limits and groups, "Add to Jordan?" (`offerFor`), the safe
  calculator (never eval), where each layout puts a window, and the ring's tools.
- `shared/note-core.mjs` — the note record (`normalizeNote`, `parseTags`), shared so the main
  process makes notes exactly like the windows (`src/note-core.js` re-exports it).
- `shared/node-file.mjs` — node files, read one way everywhere (drop folder, the Sky's Import, the
  connector): JSON (the Import format plus `source`) or Markdown (`# node`, `## branch`, list items
  are stickies, front matter `source:`); `isPacked` (title and summary only), `nodeRecords`,
  `arrivalOps` (a New node, packed when it's only a summary, or `{ duplicate }` by fingerprint),
  `fromOf`, `botInstructions` (what "Copy instructions for a bot" copies; its examples are tested).
- `shared/providers.mjs` — cloud model presets, `cleanKey`/`cleanBaseUrl`/`providerFrom`, model ids
  `cloud:<provider>:<model>`, `explainFailure` (one plain line), usage and `cleanBotSettings`.
- `shared/ai-tasks.mjs` — the model's small jobs, each a question and a forgiving reader:
  Unpack with AI (Markdown back), Help me sort ("sticky: branch" lines) and Sort Unsorted (Phase 26:
  "n: place number", "n: new: Name" or "none" per sticky; `readSortUnsortedAnswer`).
- `shared/connector-tools.mjs` — the connector's four tools as pure `runTool(name, args, { doc })`
  → `{ text, ops }`, names or ids, and `connectorSetup` (the lines for Claude Code / Desktop).
- `shared/sync-core.mjs` + `shared/sync-engine.mjs` — pure sync, for the Mac now and the iPhone
  app next. Every change gets a hybrid-clock stamp (`<ms>.<count>.<device>`, sorts as text);
  each device keeps per-field stamps (`meta`) and merges others' changes field by field, newest
  stamp winning, so all devices converge whatever the order (a randomized test proves it). A
  delete wins over earlier edits; a later add (Undo) brings a record back; an edit that arrives
  before its record waits in meta. Note text (`notes.markdown`) also carries version vectors:
  two versions written without seeing each other are merged (`mergeText`: the newer text plus
  the lines only the older has), and the merging device shares the result as a new change so
  every device settles on the same text. The engine writes only `Sync/<device>/<seq>.json` and
  `snapshot.json`, reads the others', and a new device catches up from the newest snapshot.
  What a device held before its first sync is stamped oldest (`baseStamp`).
- `shared/store-core.mjs` — pure, used by main, every window and the tests: the schema,
  `createEmptyDoc`, `diffDocs`, `applyOps` (returns the inverse, for undo), `validateOps`,
  `compactOps`, `migrations[]` and the hub. It is unpacked from the app archive
  (`asarUnpack`) so the main process can `import()` it.
  - `under.cjs`: Offline's engine. One flag (`prefs.under`, read before anything starts): main's
    fetch and every session's requests refuse all but this Mac (loopback, so LM Studio works),
    `refusal(channel)` answers what waits in plain words, browser tabs sleep, downloads (the
    AI's too) pause and resume, the iPhone link pauses. The renderer talks to it as `osatUnder`.
  - `browser.cjs`, `terminal.cjs`, `local-ai.cjs` (LM Studio on 127.0.0.1:1234),
    `path-guard.cjs`, `text-files.cjs`.
- `ios/` — the iPhone app: a SwiftUI shell (XcodeGen `project.yml`) showing the web app with
  `?surface=phone` over an `osat://` scheme; `NativeBridge.swift` gives the page its own files
  and the app's iCloud folder. `desktop/phone-root.cjs` moves the Mac's OSAT folder into that
  iCloud folder once it exists. See docs/IPHONE.md.
- `src/` — React 19 renderer, built by Vite.
  - `store/`: `useWorkspace()` (one client per window), `client.js` (sync `commit(updater)`,
    batched operations, confirmed vs pending so edits never bounce back), `bridges.js`
    (the Mac app's `window.osat.store`, or an IndexedDB-backed hub for the browser preview;
    `?fresh=1` starts the preview empty).
  - `App.jsx`: picks the surface: the desk (`shell/Desk.jsx`), `?surface=phone` the iPhone app (`surfaces/Phone.jsx`: Today, Notes, iCloud), `?surface=chat`
    the quick chat (`surfaces/QuickChat.jsx`: the Ask room with `compact`).
  - `lib/spaces.js`: the one list of spaces (Desk, Notes, Sky (id `Mindmap`), Ask, Files), tools and
    Settings. The dock, ⌘K and ⌘1–5 read it; the Mac Go menu in `main.cjs` mirrors it by hand.
  - `views/Roadmap.jsx`: Tools → Roadmap (also ⌘K and the Go menu) shows docs/ROADMAP.md, built in
    with `?raw` and drawn by `lib/markdown.jsx`. Nate reads it there: keep it in plain words, the
    Status table first. Its Timeline view (`lib/roadmap.js`, `roadmapPhases`) is drawn from that
    same Status table, so keep the table's three columns (Phase | What | State: "Merged (PR #n)",
    "In review", "Planned"); a date in the State cell shows, none is needed.
  - `views/Bots.jsx`: Settings → Bots, the one place for bots, models and what leaves the Mac:
    the drop folder, which model answers, cloud models (keys never reach the page), the
    connector (its key only ever goes to the clipboard). Scans stay in Settings → Data (Phase 15).
  - `surfaces/QuickSearch.jsx` (+ `search/`: `useSources`, `Preview`, `Ring`, icons): the quick search panel and the
    ring; `?surface=search` and `?surface=ring`. In the browser preview they run on a stand-in bridge
    (`tests/ui/search-bridge.mjs`). `views/Launcher.jsx` is Settings → Launcher; `field/ClipboardOffer.jsx` is the
    desk's "Add to Jordan?"; the line (`field/Line.jsx`) reads `readLine` and adds launcher rows under "Save as a
    sticky"; `lib/bot-jobs.js` is where bots that can take a `>` job will register. `shell/dock-model.js` and
    `shell/placement.js` know which edge the dock is on (bottom, left or right; kept in localStorage), `shell/ToolsWheel.jsx`
    is Tools, `field/widget-size.js` keeps a widget's size in `places['size:widget:<id>']`.
  - `lib/carry.js`: the one drag engine (`carryable(item)` on what's picked up, `useDrop(id, spec)`
    on places that take it, with `accepts`, an `axis` for lists of `[data-slot]` items, `spring`
    for hover-to-open; `onCarryEdge` makes the top/bottom of the screen change layers). A ghost
    follows the pointer, a line shows where in a list it lands, Esc puts it back.
    `useOutsideFiles()` lets files dragged in from Finder fall on the same places (`data.files`, native
    `dragover`/`drop` on the room, the target found with `targetAt`); `carryable(item, { out })` calls `out`
    when the pointer leaves the window, and Files uses it to start the Mac's own drag.
    `lib/ContextMenu.jsx`: `useContextMenu()` right-click menus (step-in lists, paper swatches).
  - `shell/glass.jsx`: the liquid-glass SVG filter (`GlassDefs`), `useAlive()` (cursor light on
    `.glass`/`.lit`, `--px/--py` for parallax) and the dock's magnify.
  - `shell/Desk.jsx`: the desk and its two layers — the Sky above (`sky/Sky.jsx`, state `sky`,
    ⌘3 / ⌥⌘↑ / a sticky held at the top) and the desk (`FieldDesk`: widgets, the line, the shelf of
    Desktop files or nodes and notes, stickies on the desk via `field/DeskStickies.jsx`, the
    right-click desk menu). Offline is a switch at the end of the line (`Line.jsx`, `offline` /
    `onOffline`; also ⇧⌘U, the menu-bar icon and "Offline" in ⌘K): the desk stays, a calm line
    under it says so, and Browser, Terminal and Now Playing say they wait (`ONLINE_ONLY`). The dock
    (`shell/Shell.jsx`: `Dock` with app launchers; Tools holds Appearance, which opens Settings →
    Appearance; its Sky button takes a dragged sticky) and every room as a solid draggable pop-out (`ROOMS`, `PopRoom`; double-click the bar
    to fill the screen). Rooms open beside the line (`shell/placement.js`); when one covers it,
    the line rises (`raised`). Esc leaves a field in a pop-out, then closes the top pop-out, then
    comes back to the desk from the Sky; it never puts the desk away (⌥Space and ⌘W
    do). Also the welcome, capture (⇧⌘N) and the menu-bar commands. The browser preview shows a
    stand-in desktop and keeps `places` in localStorage.
  - `sky/`: `Sky.jsx` (the layer: find a sticky, Import a node file, the actions and menus,
    Help me sort: `suggestionGroups`, one line per branch with Move and Dismiss; with a model, it is
    asked about the stickies matching words couldn't place; Unpack with AI / By hand on a packed
    node; `useAi` reads the model list again when Bots changes; Phase 26: `SkyAsk.jsx`, the pill at the bottom
    and its card: ask about the Sky (`useAskHere` with `context: { open, where: 'sky' }`), or say "sort these"
    (`asksToSort`) / press Sort Unsorted: `sort-unsorted.js` (pure: `sortRequests` in batches of 20, at most 60
    stickies, `modelSuggestions` / `wordSuggestions` → groups `move` / `make`, `stillToSort`, `applyGroup`,
    `undoGroups`), one line per group with Move / Make it and Dismiss, "Move them all", one Undo. Unsorted and each
    branch fold (`osat.sky.folds.v1`: `'unsorted'` or a branch id; `actions.folds` / `actions.fold`)),
    `Board.jsx` (the infinite whiteboard: the camera `{x, y, z}` in CSS vars `--cx/--cy/--z`,
    registered with `@property` so a flight glides; node cards at `boardSpots`, dragged directly,
    opened in place as a tree (Phase 16: `NodeLanes` → `Branches` → `Lane`: the node's own stickies
    first, under "Not in a branch yet" once it has branches; each branch a label (a dot of its colour
    and its name) on a line, its stickies in a row, its own branches on a line under it; only stickies
    are paper; a branch dropped on a branch's name goes inside it; a closed card lists its first three
    branches); opening a node never moves the other cards: the camera flies to it (`goTo`, `frameTop`: a node taller than the view shows its top at 60% or more), the others dim, and closing the last one flies back (unless the board was moved since); lines for @mentions;
    far out (`z < 0.5`) names grow and insides fade), `Piles.jsx` (`StickyList`, `AddSticky`,
    `NameField`), `Sticky.jsx` (one sticky: click to write, carry, right-click). `SkyGuide` (in Sky.jsx):
    "How the Sky works", shown once per Mac (`osat.sky.guide.v1`), again from ? or the board's menu.
    New branch / New branch inside are named in place (`actions.branching`); Rename for a branch
    goes through `actions.renaming` like a node's.
    Cards drift forever, so Playwright clicks on them need `{ force: true }`.
  - Models (pure, unit-tested): `osat-data.js` (workspace shape), `notes-model.js`,
    `note-core.js`, `nodes-model.js` (ranks, moving stickies/nodes/branches, `moveToItems` (every
    Move to menu), @mentions, `importNode`, the board's spots, sorting suggestions), `project-direction.js` (the
    seeded first node), `board-model.js` (the old boards' data only; normalized on load, no longer kept in step), `next-steps.js`,
    `daily-practice.js`, `field/field-model.js` (desk items, `freeSpot` for new stickies).
  - `shell/Welcome.jsx`: the first launch — what stays private, the shortcut, the AI's size.
  - Rooms: `field/` (home desk, widgets), `notes/`, `assistant/` (Ask:
    `chats.js` pure chat helpers, `useAi.js`, `LocalAssistant.jsx` with `ActionCards`/`UsedNotes`; Phase 26:
    `board-context.js` (`boardMap`: the words-only map of nodes, Unsorted, open nodes, Next and the Calendar
    every question carries, `OSAT_GUIDE`, `planLines` for a question about the roadmap), `ask-context.js`
    (the windows' side: adds the bundled roadmap) and `useAskHere.js` (the streaming answer the desk's line and
    the Sky's card share)),
    `views/` (Calendar, Journal (with Reflection as its tab, Reflection's one home), Habits,
    Budget, NowPlaying, Obsidian, Settings (four tabs: General, AI, Bots, Data; `sectionFor` maps old tab
    names); schema 4 folds each project into a node, `projectNodes` in store-core, and keeps `projects`), `lib/find.js` (what the line finds), `tools/` (Browser, Terminal).
  - `views/Files.jsx`: a small Finder (places and your folders, back/forward, Space for Quick
    Look, Ask about it, New folder / Rename / Move to / Move to Bin with Undo, ⌘/⇧-click to pick
    several, drag onto a folder with `carry.js` (⌥ copies; a drop says `alt`), a find box: results from every place, keyed `rootId + relative`, each
    saying where it lives, with Show in its folder) and the pieces the desk reuses: `FileThumb`, `useFolder`,
    `useFreshness` (folders refresh when the window comes back). The desk's right side shows
    the Mac's Desktop (click picks, double-click or Return opens, a folder opens in Files) or,
    switched to OSAT, the notes and folders.
  - Styles: `src/styles/`, tokens in `tokens.css`.
  - `lib/UndoToast.jsx`: `useUndoToast()`, the one Undo toast (Notes, Money, Calendar); remove at once, offer Undo. `glass.css` loads last: the glass kit, the dock,
    transitions, and the token overrides that make the quick chat see-through.
- Words (Phase 12): one word per thing everywhere: sticky, note, node, branch, Unsorted,
  Delete, Move to, New node / New branch, Write a sticky, Color. Never thought (for a card),
  folder (for a node), Unfiled, To sort, Toss, Clear, Put inside, Make it a node. Nodes show
  names only, never numbers. (Files keeps "folder": those are the Mac's real folders.)
  Offline (Go Offline / Go Online), never Incognito, Under, Come up or scratch page.
  Phase 16: a node's own stickies, once it has branches, are "Not in a branch yet" (never
  "Stickies"); Unsorted says "Stickies in no node yet"; "New branch inside" makes a sub-branch.
  The one-line model everywhere: a sticky is one thought, a node is a topic, branches group the
  stickies in a node (and can hold smaller branches). "Leaves" is only the node file's word.
  Phase 18: New (a node that just arrived), packed / Unpack (only a summary so far), "from Muse",
  Bots, cloud model, key, the connector.
- Nodes (schema 3): every top-level folder is a node, a folder inside one is a branch, a note is a
  sticky. Order is `rank` (`rankOf`: a missing rank is the creation time, so only hand-ranked
  things carry one); folders may have `color` and `at` ({x, y} on the Sky's board; `placeNodes`
  freezes every node's spot and re-ranks left to right); notes may have `color`. Old `links` and
  `layout` are kept in the data but no longer shown or offered (Phase 12).
- Loose branches (Phase 27, schema 8): a branch can sit on the Sky on its own. It is a top-level folder
  marked `kind: 'branch'` (`isBranch(folder)` in notes-model: a `parentId` or that mark; normalization drops the
  mark inside a node, and a branch whose node went missing stays a loose branch). It is drawn as a card on the
  board like a node but on a branch's paper, with a branch's menu; a branch carried out onto the board stays a
  branch (`moveFolder(state, id, null, Infinity, { loose: true })`); "Its own node" in Move to makes it a node.
  Everything that lists top-level folders (`nodesOf`, Notes, the connector, import) still sees it as a
  top-level entry; only the Sky, Find's hint and the AI's map (`board-context.js`) tell them apart. "Where does
  this belong?" (`sky/where.js`, `whereMessages`/`readWhereAnswer` in ai-tasks): the model picks one node or
  branch with a reason (`placing` in Sky.jsx, `PlaceHelp` in Board.jsx); nothing moves until Move (it checks the
  branch and the place still exist and are not inside each other), and Undo restores the branch's old record.
- Free stickies (Phase 27 step 3, schema 9): a note may carry `at: { x, y }` in Sky board points.
  `New sticky`, double-click and the empty-board menu write one at that position; no node is created.
  `placeSticky` in nodes-model moves the same note out onto the board; `null` returns it to the Unsorted
  pile. Board draws active, unfiled notes with `at` as free paper, and only unplaced ones in that pile.
  Arrow keys move a focused free sticky (Shift moves further); Find and See everything include them.
  A filed sticky keeps its former position for when it becomes loose again. Sending up from the desk
  places it near the Sky viewport, clears its desk place after the workspace change, and offers Undo
  of both. Dragging it back to the desk clears its Sky presentation. Notes, backups and sync use the
  same note and saved position. Connectors, selection/bundling and focused node editing are still next.
- @mentions (`nodes-model.js`, schema 4): an @ only links, it never files or makes a node.
  `findMentions` (longest node name wins, `/` for a branch, never after a letter/dot, so emails
  don't count; a name that matches no node is just words), `linkMentions(state, id)` records
  `note.refs` ({ written name: folder id }) so a renamed node keeps its links and no words are
  ever rewritten (`renameFolder` only renames). `addSticky`, the line, `writeSticky`, the Journal
  and the note editor (when writing ends) call `linkMentions`. `splitMentions` draws them as links
  (`md-mention` in Markdown, `sticky-mention` on stickies). Unsorted everywhere is "in no node"
  (`isUnsorted`: or captured and not sorted yet). A note in no folder is Unsorted in the Sky. Where stickies lie is per Mac:
  `places['note:<id>']` on the desk ({x, y} fractions, w/h). Schema 5 turned the old scratch
  page's stickies (`kind: 'scratch'`) into ordinary ones in Unsorted; a sticky saved while
  offline is ordinary too, with `source: 'Offline'`.
- A sticky from a scan may carry `ask: { event: { title, date, time } }` (schema 6): its node, when
  opened, asks "Add it to your Calendar?" (`asksIn`, `addAskedEvent`, `skipAsk` in nodes-model).
- Arrivals (schema 7): a node from the drop folder or the connector carries `fresh` (New until
  first opened: `markOpened`), `packed` when it is only a summary (until a branch, By hand or Unpack
  with AI: `markUnpacked`, `unpackInto`) and `from` ({ source, file, hash }, cleaned by `fromOf`).
- Data rules: a captured sticky is one note with `unsorted: true` and a `source`; filing,
  pinning or Keep clears it. Each day has one note, `day-YYYY-MM-DD` with `kind: 'day'`
  (`ensureDayNote`): it is the journal page and where new next steps land. Wikilinks follow
  a renamed note when the title edit ends (`relinkRenamedNote`), not on every keystroke.
  `reconcileBoards` returns the same object when nothing changed. Changing the schema means
  bumping `SCHEMA` and adding a step to `migrations[]` in `shared/store-core.mjs`, with a test.
- Ask's chats live in the workspace (`chats`, schema 2). Each question reads the notes
  `relatedNotes()` picks (shown as removable chips, kept on the message as `noteIds`), and any
  attached files (dropped, chosen, or "Ask about it" in Files; only their names are kept, as
  `files`). Asking on the desk answers in a card under the line and saves the
  chat; Pop out moves it to the quick chat. Action cards (add a step, a note, an event) only
  appear when the question asks for something to be added.

## Layout traps worth remembering

- The desk (`.overlay-surface`) is `100dvh` and never scrolls; each pop-out's body is a
  `.workspace-content.is-filled` and its room uses `height: 100%`.
  Never write `calc(100dvh - <number>)`.
- Grid tracks: write `minmax(0, 1fr)`, not `1fr`, and always declare columns, or wide
  children push the track past the viewport.
- `backdrop-filter` only blurs what shares its backdrop root: no element containing glass
  may carry opacity, filter or a view-transition name.
- Colours: neutral greys and `--accent` (the Mac's accent, painted by main as `--mac-accent`);
  no brown, orange or green chrome. Sticky papers (`[data-paper]` → `--paper-bg`) stay bright in
  both looks with dark ink.
- `.overlay-surface` is `overflow: clip`, never `hidden`: focusing something half off-screen must
  not be able to scroll the whole desk.
- Pop-outs, menus, dialogs and toasts are solid (`--page`, `--surface-raised`): in the Mac app
  `backdrop-filter` doesn't reach the desk behind a pop-out, so anything translucent over other
  content shows it crisp through. Glass is only for things that sit over the bare desktop.
- Layers on the desk: widgets and icons, stickies (`.sticky-layer`, z 3), the line (z 4), rooms
  (`.popouts`, z 10), then the dock and a risen line (z 11+); the Sky (`.sky-shell`, z 13) covers
  it all, with rooms opened from it above (14). `.overlay-surface` is the one stacking context;
  `.home` must not become one.
- Rooms lay themselves out for their pop-out: `.popout-body` (and `.quick-chat`) is a
  `container: room / size`, and room styles use `@container room (max-width: 960px | 760px |
  560px)`. Only the desk itself uses `@media`.
- In the quick chat `--page` is transparent: never use it as a text colour; use `--on-solid-ink`.
- `.glass` draws its rim and cursor light with `::before`/`::after`; don't give glass elements
  other pseudo-elements.
- Every token lives in `tokens.css` (Mindmap's `--paper-*` and `--desk` too); app-wide layers use
  `--z-*`, type sizes `--t-*`, and the only desk breakpoints are 1100, 900 and 720px.
- Ad-hoc signing a build inside `~/Desktop` (iCloud-synced) fails with "detritus not allowed";
  build elsewhere: `-c.directories.output=<folder outside Desktop>`.
- The dock is a grid child whose row is the desk's foot: on a side edge it needs `grid-column/row: auto` so the
  desk's whole box is its containing block. `input:not([type])` beats a bare class, so panel fields use
  `.quick-search .qs-input`-style selectors.
- Never launch a packaged build against Nate's real `~/Library/Application Support/OSAT` to
  test: it would upgrade the schema under his installed app. Use `--osat-self-test`.
