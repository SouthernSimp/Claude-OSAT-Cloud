# What to do next, ranked

One list for every idea, so none gets lost. Ranked by how much it protects trust in
OSAT first, then how much it saves Nate effort, then "wow". Claude keeps it current:
when something lands it moves to Done; when a new idea comes up it gets a rank here
the same day. Last sorted: October 6, 2026.

## Now: make sure what exists is real

| # | What | Why it ranks here | State |
|---|---|---|---|
| 1 | Build the Mac app (DMG) from main and try it with isolated data | Nothing from Codex's week has run as a real Mac app; Notes AI, Stop and offline use are unproven there | Done: main's Mac build passed and is a release |
| 2 | Stop the hosted Mac build being cancelled: `ci.yml` had `cancel-in-progress: true`, so any newer run on the same branch killed it | It is why no DMG existed; every future build would fail the same way | Done (PR #45) |
| 3 | Ask says when it dropped old messages or notes to fit the model's memory | The AI forgets silently today; trust in the AI is the point of the app | Done (PR #46) |
| 4 | Notes AI speaks to you ("you") instead of "the user" | One-line prompt change; real-model answers read cold | To do |

## Next: save Nate effort

| # | What | Why it ranks here | State |
|---|---|---|---|
| 5 | Update button (Settings → Check for updates): finds the newest build on GitHub, downloads it, swaps `/Applications/OSAT.app`, relaunches; notes untouched | Ends the manual reinstall every time | Done (PR #45, verified on Nate's Mac Oct 6) |
| 6 | Real background auto-update with Apple Developer ID signing and notarization | Would end "Open Anyway" and the permission re-asks after updates. **On hold: it needs the paid Apple Developer Program ($99/year) and Nate does not pay for it (Oct 6).** The update button (#5) already works without it. Revisit only if OSAT goes to the App Store or other people install it | On hold (cost) |

## Then: smoother thinking

| # | What | Why it ranks here | State |
|---|---|---|---|
| 7 | Sky → Notes → AI navigation that doesn't lose your place | Codex's own top follow-up | Planned |
| 8 | Find saved AI replies again (they are linked notes today, easy to lose) | Pairs with #7 | Planned |
| 9 | Phase 27 leftovers: combine and split stickies | Real but not blocking | Planned |

## Later: bigger bets (Roadmap phases)

14 Connectors (Calendar and Reminders in review) · 21b Tidy my Desktop · 19 OSAT's own bots ·
20 Capture anywhere · 22 Files in the Sky · 23 Nodes become projects · 25 The Stratosphere ·
28 Tags that do things. The iPhone app stays parked.

## New ideas land here first

Anything Claude suggests in conversation goes in this table the same day, ranked on the
next sort, so nothing depends on anyone remembering the chat.

| Idea | Suggested | Rank |
|---|---|---|
| Use the DigitalOcean droplet for extra features (Nate, Oct 6, "eventually, idk"). Needs a goal first, e.g. a private sync relay or hosting a bigger model; would have to stay opt-in and keep notes private | Oct 6 | Unranked |
| UI smoke test flake: "widgets: Esc did not put the tray away" failed once on a pull-request run and passed on rerun (Oct 6). Make the wait explicit so a red check always means a real problem | Oct 6 | Unranked (small, would rank near #2) |
| Show this ranked list inside OSAT beside the Roadmap (Tools → Roadmap) so Nate reads it in the app | Oct 6 | Unranked |
| Attach reference images inside a sticky on the desk (Nate's idea): drop a picture onto a sticky, it shows small inside it and opens big | Oct 7 | Unranked (not Phase 13c) |
| The ring over other apps with ⌘ + middle-click (today only Hyper R works there): needs a global mouse hook, a native helper and Input Monitoring | Oct 7 | Unranked (with 13d's helper) |
| Settings: Launcher → Quick bar and General both hold the bar's keys; fold them into one place once Nate says which he looks in | Oct 7 | Unranked (small) |
| The ring's window layouts on the desk's own ring are left out (they move other apps' windows); say so on the ring itself, not only in Settings | Oct 7 | Unranked (small) |
| A dragged quick bar has no "put it back in the middle"; add one to its ⌘K or the ring's menu if Nate misses it | Oct 7 | Unranked (small) |
| Old clipboard pictures keep the thumbnail they were saved with (tall ones can be big); new ones are capped. Re-make old ones once at start if it matters | Oct 7 | Unranked (small) |

| Screenshots and recording from the launcher, driving CleanShot X (Phase 13g) | Oct 6 | In review |
| Record the screen without CleanShot (Phase 29, proposed): see "Recording made in OSAT" below | Oct 6 | Later: CleanShot already does it; wait for Developer ID signing (#6) |

## Raycast gap (Oct 7)

What Raycast has that OSAT's quick bar doesn't, ranked by how much it would save Nate for how little it costs.
Researched from Raycast's own pages ([manual](https://manual.raycast.com/llms.txt), [What's new in v2](https://manual.raycast.com/new-in-v2.md),
[changelog](https://raycast.com/changelog/1-37-0)). "Have" means it already works in OSAT.

| # | Raycast | OSAT today | Cost | Rank |
|---|---|---|---|---|
| 1 | Clipboard history: text, links, images, files, colours; pins; search; paste; keep every original format | Have: text, links, emails, phones, numbers, pictures, pins, search, paste, drag out (13c). Missing: copied files and colours, rich text/original formats | Medium (files: read `public.file-url`; formats: keep more pasteboard types) | 1 |
| 2 | Snippets: a keyword typed in any app expands to saved text ({date}, {clipboard}, {cursor}) | Pinned copies are snippets you paste from the bar; no typing-to-expand | Hard: expanding while typing in other apps needs Input Monitoring and a key-watching helper. Cheap half: a snippet's word in the bar pastes it | 2 (do the cheap half) |
| 3 | Calculator: sums, units, currency, dates ("days until Christmas"), percentages, natural words | Have: sums and percentages (`2*49`, safe, no eval). Missing: units, currency (needs the internet), dates | Small for units and dates; currency waits while offline | 3 |
| 4 | Quicklinks with {query}, per-link hotkeys | Have (13b): named quicklinks, {query}, a word and a key each | — | Done |
| 5 | Window management: halves, thirds, corners, next display, keys | Have: 16 layouts, keys, the bar ("left half"). Missing: move to the next screen, drag-to-edge, gestures | Next display: small. Gestures: Phase 13d | 4 |
| 6 | Floating notes: one small note that floats over everything | Close: a sticky saved from the bar (⌥Return), stickies on the desk. Missing: a sticky that floats over other apps | Medium: a small always-on-top window per pinned sticky | 5 |
| 7 | File search with preview and actions | Have: Spotlight, words inside files, filters, big preview, Open / Show in Finder / Copy path / Ask about it / Pin / Delete | — | Done |
| 8 | Per-command hotkeys and aliases (any command gets a key and a word) | Partly: sources, apps, links, layouts and the ring have words and keys. Missing: rooms and actions (e.g. a key for "Tidy my Desktop") | Small to medium: give lib/find.js actions an optional key in Settings → Shortcuts | 6 |
| 9 | AI: Quick AI from the bar, AI chat, AI commands | Have (13c): ⌘Return asks from the bar, the chat stays in the same window. Missing: saved prompts as commands ("Summarise what I copied") | Small: a command list of prompts | 7 |
| 10 | System commands: lock screen, sleep, empty Bin, toggle dark mode, quit apps | Missing | Small each (AppleScript); Empty Bin needs a confirm (calm rule 2) | 8 |
| 11 | Search menu items of the app you are in; switch windows | Missing | Medium: Accessibility reads menus and windows | 9 |
| 12 | Extensions store, script commands | Bots (Phase 19) and the connector are OSAT's version | Large | Later |

Done in 13c from this list: the bar asks the AI (⌘Return) and saves a sticky (⌥Return); clipboard pictures show and
drag out. The calculator already answers sums; nothing new was cheap enough to add without a test of its own.

## Recording made in OSAT: what it would take (researched Oct 6)

Today OSAT asks CleanShot X to record (Phase 13g). Building it ourselves, ranked by effort, smallest first:

| Piece | Electron only (desktopCapturer + MediaRecorder) | Small Swift helper (ScreenCaptureKit) | Estimate |
|---|---|---|---|
| Permission | Screen Recording, asked by macOS the first time a source is listed; no button can ask for it. macOS 15 re-asks about once a month | The same permission (macOS gives it to OSAT, the app that starts the helper), same monthly re-ask | Same either way |
| Record a screen or a window | A hidden window records a `getUserMedia` stream; WebM, or MP4 (H.264) in recent Chromium; the browser's encoder, more CPU | `SCStream` + `SCRecordingOutput` (macOS 15) writes an MP4/MOV with the Mac's hardware encoder; can leave OSAT's own windows out | 2 days / 2 days |
| Record an area | Our own see-through picker window, then crop every frame through a canvas (more CPU, can drop frames) | The same picker window; ScreenCaptureKit records just that rectangle | 2 days / 1 day |
| Sound | Microphone easy; system sound needs Chromium's macOS loopback, newer and less proven | System sound and microphone are built in | 1 day / half a day |
| Stop and show the result | A menu-bar Stop and a small Quick-Look-style result panel | Same | 1 day |
| Trim | Needs ffmpeg bundled (large, licensing to check) or a WebCodecs remux | AVFoundation's export with a time range, a few lines | 2 days / half a day |
| Save as GIF | A JavaScript GIF encoder fed frame by frame, slow for long clips | ImageIO writes an animated GIF natively | 1 day / half a day |
| Annotation (arrows, boxes, blur) | An editor over a still picture: the real cost, a room of its own; on video, much more | The editor is web UI either way | 3–5 days |

**Recommendation:** keep CleanShot X (Nate owns it and it does all of this well). If OSAT ever records on its own,
build the small Swift helper with ScreenCaptureKit, not Electron's desktopCapturer: smaller files, less CPU, OSAT's
windows left out, native trim and GIF. About a week of work without annotation (3–5 days more with it). Do it only after Developer ID signing (#6):
with ad-hoc signing every update looks like a new app to macOS, so Screen Recording would be asked for again after
each update. Screenshots without CleanShot already work through the Mac's own `screencapture` (13g).

## Housekeeping (whenever)

- The old `OSAT Field copy` folder is stale and full of stray "…2" duplicate files; archive it once Nate agrees.
- GitHub warns that the Node 20 actions (`checkout`, `setup-node`, `upload-artifact`) are being forced to Node 24; bump them before it breaks.
