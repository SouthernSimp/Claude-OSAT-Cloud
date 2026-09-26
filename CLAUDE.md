# OSAT — notes for Claude

OSAT is Nate's personal, private "second brain" for the Mac. It is a calm layer over the
Mac: press a hotkey anywhere to drop a thought, find something or ask your own notes,
and open the window to sort and think. Everything, including the AI, stays on the Mac.
It is built for one person first; the App Store and a phone companion come later.

The direction and the phase-by-phase plan live in [docs/ROADMAP.md](docs/ROADMAP.md).
Read it before any substantial change and keep it current when a phase lands.

## Working with Nate

- Nate is new to git and GitHub. Claude runs the repo: one branch and one draft pull
  request per phase, with a plain-English summary, a "How to try it" section and a short
  Mac checklist. Nate tries the DMG that CI builds and says "merge"; then Claude merges.
- Explain in plain words. Nate would rather see the result than the internals.
- Display the name `OSAT` only and never spell out the letters.

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
npm run ios            # opens the iPhone app in Xcode (needs Xcode's license accepted and
                       # `brew install xcodegen`); see docs/IPHONE.md
npm run dev            # web preview at http://127.0.0.1:5173 (its own browser data)
npm run start:mac      # build and run the Electron app from source (data: "OSAT Dev")
npm run install:mac    # build the DMG and install /Applications/OSAT.app (macOS only)
```

The cloud container is Linux: tests, the build, the web preview and Playwright
screenshots work there; the Electron app, the global hotkey, vibrancy and the Mac menu
bar can only be checked on a Mac (the CI `mac` job builds and launch-checks the DMG).
The iPhone app is built and screenshotted in the simulator by the CI `iphone` job; on
Nate's Mac, Xcode's license isn't accepted yet, so don't try to build iOS locally.

## Architecture today

- `desktop/` — Electron main process (CommonJS).
  - `ai/`: the AI that sets itself up. `catalog.cjs` (Light / Balanced / Deep: Gemma 4, pinned
    URL + size + SHA-256, `pickTier(memory)`), `download.cjs` (resumable `.part`, checksum, free
    disk), `runtime.cjs` (node-llama-cpp in a `utilityProcess`, one chat at a time, Gemma's
    thinking turned off), `index.cjs` (`createAi`: the chosen size in `prefs.json`, background
    download, engine starts on the first question and stops after 10 idle minutes; `mock`).
    Model files live in `<data folder>/models`. LM Studio still works through `local-ai.cjs`.
  - `main.cjs`: windows, menu, IPC for the store / files / local AI / browser / terminal,
    the ⌥Space layer and the ⌥⇧Space quick chat (two shortcuts in `shortcuts`, menu-bar icon, app
    launchers, Esc routing: a panel swallows Esc, so OSAT takes it while the layer is up or the
    chat has focus), single-instance lock. Looking at files, the browser and the terminal answer
    the main window and the layer; choosing, writing and forgetting folders only the main window.
  - Files: Desktop, Documents and Downloads are built-in places (ids `desktop`/`documents`/
    `downloads`, macOS asks once per folder; tests set `OSAT_PLACES_DIR`, from source only) beside
    the folders Nate adds (grants). Hidden files never show; apps, scripts and installers are shown
    in Finder, never opened (`isSafeOpenFilename`). Thumbnails are Quick Look's
    (`nativeImage.createThumbnailFromPath`); `app.getFileIcon(…, { size: 'large' })` crashes
    Electron 43 on the Mac, so don't use it.
  - `mac-files.cjs`: the places, what Finder counts as one file (packages), Spotlight search
    (`mdfind -onlyin … -name`) and the text Ask reads from a file (PDFKit through `osascript -l
    JavaScript`, Word/RTF through `textutil`, capped at 12,000 characters).
  - `quick-chat.cjs`: the quick chat window, a floating panel on every Space that stays where
    it's left (`chatBounds` in `prefs.json`).
  - `media.cjs`: Spotify on the layer through AppleScript (now playing, play/pause, skip).
  - `phone.cjs`: the iPhone link, off until turned on in Settings → iPhone. An `OSAT` folder in
    iCloud Drive: text dropped in `Inbox` becomes an Unsorted note (source `iPhone`) and moves to
    `Inbox/Added`; `Notes` holds a read-only Markdown copy (only files listed in its
    `.osat-mirror.json` are ever changed). Turning it off removes the copy. macOS asks before an
    app looks in iCloud Drive, so nothing touches it until the link is on. Tests set
    `OSAT_ICLOUD_DIR` (from source only).
  - `sync.cjs`: the same switch keeps devices in step through `OSAT/Sync` (see sync-core below).
    It hooks `store.onCommit` to note every change made here (except what sync applied), keeps
    its place in `store/sync.json`, and once set up it notes changes even while the link is
    off (loaded before any window opens) and sends them when it comes back on.
  - `overlay.cjs`: the layer window — full-screen, see-through, a macOS panel with vibrancy on
    the display under the cursor. Created hidden at launch and only ever hidden, never closed.
  - `store/`: the workspace lives here. `index.cjs` owns the one document (via the shared
    hub), saves it 250 ms after a change, and does a final synchronous save on quit.
    `file.cjs` writes `store/workspace.json` atomically, keeps 14 daily snapshots and sets an
    unreadable file aside instead of deleting it.
  - `data-folder.cjs`: data lives in `~/Library/Application Support/OSAT` (`OSAT Dev` from source).
    An older folder without our marker is renamed aside, never read or deleted.
  - `preload.cjs`: the bridges exposed to the renderer (`osat.store`, `nateOSFiles`,
    `osatLocalAI` (models, `chatStream` → `{ done, cancel }`, and the built-in AI's status /
    choose / cancel / resume / remove), `osatBrowser`, `osatTerminal`, `osatApp` (incl. the
    first-launch welcome), `osatOverlay`, `osatChat`). An AbortSignal can't cross the bridge; pass
    functions. A dropped file's path comes from `webUtils.getPathForFile` in the preload, never
    from the page.
- `shared/note-core.mjs` — the note record (`normalizeNote`, `parseTags`), shared so the main
  process makes notes exactly like the windows (`src/note-core.js` re-exports it).
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
  - `App.jsx`: the desk is always underneath; every other room opens as a glass sheet over it
    (`shell/Shell.jsx`: `RoomSheet`, `Dock`, `Appearance`). `?surface=overlay` renders the layer,
    `?surface=phone` the iPhone app (`surfaces/Phone.jsx`: Today, Notes, iCloud), `?surface=chat`
    the quick chat (`surfaces/QuickChat.jsx`: the Ask room with `compact`).
  - `lib/spaces.js`: the one list of spaces (Desk, Notes, Map, Ask, Files), tools and Settings. The
    dock, ⌘K and ⌘1–5 read it; the Mac Go menu in `main.cjs` mirrors it by hand.
  - `shell/glass.jsx`: the liquid-glass SVG filter (`GlassDefs`), `useAlive()` (cursor light on
    `.glass`/`.lit`, `--px/--py` for parallax) and the dock's magnify.
  - `surfaces/Overlay.jsx`: the ⌥Space layer — Day/Month/Next, Note · Find · Ask line, desktop
    icons, dock with app launchers, and draggable pop-outs (Esc closes the top one, then the layer).
  - Models (pure, unit-tested): `osat-data.js` (workspace shape), `notes-model.js`,
    `note-core.js`, `board-model.js` (Mindmap), `next-steps.js`, `daily-practice.js`,
    `field/field-model.js`.
  - `shell/Welcome.jsx`: the first launch — what stays private, the shortcut, the AI's size.
  - Rooms: `field/` (home desk, Sky, `MediaWidget`), `notes/`, `board/` (Mindmap), `assistant/` (Ask:
    `chats.js` pure chat helpers, `useAi.js`, `LocalAssistant.jsx` with `ActionCards`/`UsedNotes`),
    `views/` (Calendar, Journal, Projects, Habits, Reflection, Budget, Inbox, Obsidian, Settings,
    command palette: notes, then files on the Mac from Spotlight), `tools/` (Browser, Terminal).
  - `views/Files.jsx`: a small Finder (places and your folders, back/forward, Space for Quick
    Look, Ask about it) and the pieces the desk reuses: `FileThumb`, `useFolder`,
    `useFreshness` (folders refresh when the window comes back). The desk's right side shows
    the Mac's Desktop (click picks, double-click or Return opens, a folder opens in Files) or,
    switched to OSAT, the notes and folders.
  - Styles: `src/styles/`, tokens in `tokens.css`.
  - `lib/UndoToast.jsx`: `useUndoToast()`, the one Undo toast (Notes, Money, Calendar); remove at once, offer Undo. `glass.css` loads last: the glass kit, the sheet,
    the dock, transitions, and the token overrides that make every room see-through inside a sheet.
- Data rules: a captured thought is one note with `unsorted: true` and a `source`; filing,
  pinning or Keep clears it. Each day has one note, `day-YYYY-MM-DD` with `kind: 'day'`
  (`ensureDayNote`): it is the journal page and where new next steps land. Wikilinks follow
  a renamed note when the title edit ends (`relinkRenamedNote`), not on every keystroke.
  `reconcileBoards` returns the same object when nothing changed. Changing the schema means
  bumping `SCHEMA` and adding a step to `migrations[]` in `shared/store-core.mjs`, with a test.
- Ask's chats live in the workspace (`chats`, schema 2). Each question reads the notes
  `relatedNotes()` picks (shown as removable chips, kept on the message as `noteIds`), and any
  attached files (dropped, chosen, or "Ask about it" in Files; only their names are kept, as
  `files`). Asking on the desk or the layer answers in a card under the line and saves the
  chat; Pop out moves it to the quick chat. Action cards (add a step, a note, an event) only
  appear when the question asks for something to be added.

## Layout traps worth remembering

- `.app-shell` is `100dvh` and never scrolls; `.workspace-content` is the one scroll
  container. Filled rooms (`FILLED_VIEWS` in `App.jsx`) use `height: 100%`.
  Never write `calc(100dvh - <number>)`.
- Grid tracks: write `minmax(0, 1fr)`, not `1fr`, and always declare columns, or wide
  children push the track past the viewport.
- `backdrop-filter` only blurs what shares its backdrop root: no element containing glass
  may carry opacity, filter or a view-transition name. Push the desk back with `scale` on its
  children, never a filter on the desk.
- Inside a sheet `--page` is transparent: never use it as a text colour; use `--on-solid-ink`.
- `.glass` draws its rim and cursor light with `::before`/`::after`; don't give glass elements
  other pseudo-elements.
- Every token lives in `tokens.css` (Mindmap's `--paper-*` and `--desk` too); app-wide layers use
  `--z-*`, type sizes `--t-*`, and the only breakpoints are 1100, 900 and 720px.
- Ad-hoc signing a build inside `~/Desktop` (iCloud-synced) fails with "detritus not allowed";
  build elsewhere: `-c.directories.output=<folder outside Desktop>`.
- Never launch a packaged build against Nate's real `~/Library/Application Support/OSAT` to
  test: it would upgrade the schema under his installed app. Use `--osat-self-test`.
