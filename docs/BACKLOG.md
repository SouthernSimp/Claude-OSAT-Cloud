# What to do next, ranked

One list for every idea, so none gets lost. Ranked by how much it protects trust in
OSAT first, then how much it saves Nate effort, then "wow". Claude keeps it current:
when something lands it moves to Done; when a new idea comes up it gets a rank here
the same day. Last sorted: October 6, 2026.

## Now: make sure what exists is real

| # | What | Why it ranks here | State |
|---|---|---|---|
| 1 | Build the Mac app (DMG) from main and try it with isolated data | Nothing from Codex's week has run as a real Mac app; Notes AI, Stop and offline use are unproven there | Building (run 37400300566) |
| 2 | Stop the hosted Mac build being cancelled: `ci.yml` had `cancel-in-progress: true`, so any newer run on the same branch killed it | It is why no DMG existed; every future build would fail the same way | In review (with #5: only pull-request runs are cancelled now) |
| 3 | Ask says when it dropped old messages or notes to fit the model's memory | The AI forgets silently today; trust in the AI is the point of the app | In review (Ask drops the oldest messages itself and says how many) |
| 4 | Notes AI speaks to you ("you") instead of "the user" | One-line prompt change; real-model answers read cold | To do |

## Next: save Nate effort

| # | What | Why it ranks here | State |
|---|---|---|---|
| 5 | Update button (Settings → Check for updates): finds the newest build on GitHub, downloads it, swaps `/Applications/OSAT.app`, relaunches; notes untouched | Ends the manual reinstall every time | In review (draft PR: Check for updates in Settings → About) |
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

## Housekeeping (whenever)

- The old `OSAT Field copy` folder is stale and full of stray "…2" duplicate files; archive it once Nate agrees.
- GitHub warns that the Node 20 actions (`checkout`, `setup-node`, `upload-artifact`) are being forced to Node 24; bump them before it breaks.
