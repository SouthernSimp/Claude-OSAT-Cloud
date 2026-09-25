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
                       # Linux; run `node node_modules/electron/install.js` once first)
npm run dev            # web preview at http://127.0.0.1:5173 (its own browser data)
npm run start:mac      # build and run the Electron app from source (data: "OSAT Dev")
npm run install:mac    # build the DMG and install /Applications/OSAT.app (macOS only)
```

The cloud container is Linux: tests, the build, the web preview and Playwright
screenshots work there; the Electron app, the global hotkey, vibrancy and the Mac menu
bar can only be checked on a Mac (the CI `mac` job builds and launch-checks the DMG).

## Architecture today

- `desktop/` — Electron main process (CommonJS).
  - `main.cjs`: windows, menu, IPC for the store / files / local AI / browser / terminal,
    the ⌥Space layer (hotkey, menu-bar icon, app launchers, Esc routing), single-instance lock. Files, browser and terminal IPC answer the
    main window only.
  - `overlay.cjs`: the layer window — full-screen, see-through, a macOS panel with vibrancy on
    the display under the cursor. Created hidden at launch and only ever hidden, never closed.
  - `store/`: the workspace lives here. `index.cjs` owns the one document (via the shared
    hub), saves it 250 ms after a change, and does a final synchronous save on quit.
    `file.cjs` writes `store/workspace.json` atomically, keeps 14 daily snapshots and sets an
    unreadable file aside instead of deleting it.
  - `data-folder.cjs`: data lives in `~/Library/Application Support/OSAT` (`OSAT Dev` from source).
    An older folder without our marker is renamed aside, never read or deleted.
  - `preload.cjs`: the bridges exposed to the renderer (`osat.store`, `nateOSFiles`,
    `osatLocalAI`, `osatBrowser`, `osatTerminal`, `osatApp`, `osatOverlay`).
- `shared/store-core.mjs` — pure, used by main, every window and the tests: the schema,
  `createEmptyDoc`, `diffDocs`, `applyOps` (returns the inverse, for undo), `validateOps`,
  `compactOps`, `migrations[]` and the hub. It is unpacked from the app archive
  (`asarUnpack`) so the main process can `import()` it.
  - `browser.cjs`, `terminal.cjs`, `local-ai.cjs` (LM Studio on 127.0.0.1:1234),
    `path-guard.cjs`, `text-files.cjs`.
- `src/` — React 19 renderer, built by Vite.
  - `store/`: `useWorkspace()` (one client per window), `client.js` (sync `commit(updater)`,
    batched operations, confirmed vs pending so edits never bounce back), `bridges.js`
    (the Mac app's `window.osat.store`, or an IndexedDB-backed hub for the browser preview;
    `?fresh=1` starts the preview empty).
  - `App.jsx`: routing between rooms, capture dialog; `?surface=overlay` renders the layer.
  - `surfaces/Overlay.jsx`: the ⌥Space layer — Day/Month/Next, Note · Find · Ask line, desktop
    icons, dock with app launchers, and draggable pop-outs (Esc closes the top one, then the layer).
  - Models (pure, unit-tested): `osat-data.js` (workspace shape), `notes-model.js`,
    `note-core.js`, `board-model.js` (Mindmap), `next-steps.js`, `daily-practice.js`,
    `field/field-model.js`.
  - Rooms: `field/` (home desk, Sky), `notes/`, `board/` (Mindmap), `assistant/` (Local AI),
    `views/` (Calendar, Journal, Projects, Habits, Reflection, Budget, Files, Inbox,
    Obsidian, Settings, command palette), `tools/` (Browser, Terminal).
  - Styles: `src/styles/`, tokens in `tokens.css`.
- Data rules: a captured thought is one note with `unsorted: true` and a `source`; filing,
  pinning or Keep clears it. Each day has one note, `day-YYYY-MM-DD` with `kind: 'day'`
  (`ensureDayNote`): it is the journal page and where new next steps land. Wikilinks follow
  a renamed note when the title edit ends (`relinkRenamedNote`), not on every keystroke.
  `reconcileBoards` returns the same object when nothing changed. Changing the schema means
  bumping `SCHEMA` and adding a step to `migrations[]` in `shared/store-core.mjs`, with a test.
- Chat history is still per-window IndexedDB (`osat-field-chats`); it moves into the store
  with the Phase 4 Ask rework.

## Layout traps worth remembering

- `.app-shell` is `100dvh` and never scrolls; `.workspace-content` is the one scroll
  container. Filled rooms (`FILLED_VIEWS` in `App.jsx`) use `height: 100%`.
  Never write `calc(100dvh - <number>)`.
- Grid tracks: write `minmax(0, 1fr)`, not `1fr`, and always declare columns, or wide
  children push the track past the viewport.
- `backdrop-filter` only blurs what shares its backdrop root: no element containing glass
  may carry opacity, filter or a view-transition name.
- `board.css` owns `--paper-*` and `--desk` on `:root`; never reuse those names elsewhere.
