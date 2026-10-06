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
| Screenshots and recording from the launcher, driving CleanShot X (Phase 13d) | Oct 6 | In review |
| Record the screen without CleanShot (Phase 29, proposed): see "Recording made in OSAT" below | Oct 6 | Later: CleanShot already does it; wait for Developer ID signing (#6) |

## Recording made in OSAT: what it would take (researched Oct 6)

Today OSAT asks CleanShot X to record (Phase 13d). Building it ourselves, ranked by effort, smallest first:

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
each update. Screenshots without CleanShot already work through the Mac's own `screencapture` (13d).

## Housekeeping (whenever)

- The old `OSAT Field copy` folder is stale and full of stray "…2" duplicate files; archive it once Nate agrees.
- GitHub warns that the Node 20 actions (`checkout`, `setup-node`, `upload-artifact`) are being forced to Node 24; bump them before it breaks.
