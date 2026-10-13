# Handoff — October 10, 2026 (Claude → Codex)

Read `CLAUDE.md` first (calm rules, words, architecture), then `docs/ROADMAP.md`. This file is only what is in flight.

## Where things stand

- `main` (0749003) has everything through Phase 43. Merged Oct 8: #73 (Phases 35–42) and #74 (Phase 43).
- Nate asked for "more awesome features like this" and chose: Ask uses his other apps (MCP client), Siri and Shortcuts,
  webhooks in and out, apps can do more through the connector, and "surprise me". For outside apps he chose
  **per-app keys, each "Can look" or "Can look and change", every change in Settings with Undo.**
- Two branches are pushed to GitHub, **no pull request is open yet**:
  - `claude/power` (39ad254, based on main): Phase 44 per-app keys, 45 fifteen connector tools, 46 webhooks,
    47 Siri and Shortcuts, 48a apps OSAT can use (MCP client). Reviewed twice and fixed. Last run: `npm test` 667 pass, build OK
    (before the final review-fix commit 39ad254, which was committed but whose full test run was not seen — run it first).
  - `claude/ask-acts` (7001692, based on an older `claude/power`): Phase 48b **Ask can act** (the AI loop with steps,
    Allow before another app changes, one Undo; `shared/agent.mjs`, `desktop/agent.cjs`, `src/assistant/AgentSteps.jsx`,
    `useAgent.js`; a read-only connector tool `ask` for the "Ask OSAT" Siri shortcut) and Phase 49 **the morning brief**
    (`shared/brief-model.mjs`). **Its two reviews never ran** (usage limit), so it is built but unreviewed.
- `git merge claude/ask-acts` into `claude/power` conflicts in `desktop/bots/index.cjs` only (keep both sides).

## Do this, in order

1. `git fetch`, check out `claude/power`, `npm ci` if needed, `npm test`, `npm run build`. Fix anything red.
2. Merge `claude/ask-acts` into it; resolve `desktop/bots/index.cjs` keeping both sides; `npm test`, `npm run build`.
3. Review the Ask agent and the morning brief the way the earlier ones were (correctness/security and "does it match the spec and the calm rules"):
   - Ask can act: OSAT's own changing tools run without asking and are undone together; another app's changing tool must ask first
     ("Allow" / "Not now", Esc = Not now); the built-in model is given a JSON schema, cloud and LM Studio get plain-JSON instructions; Offline blocks other apps' tools.
   - `ask` tool is read-only only, no confirmations, short plain answer (Siri reads it).
   - Morning brief: off until turned on, never triggers a macOS permission prompt, replaces only its own block in today's journal page, Undo-able.
4. Update `docs/ROADMAP.md`: add rows for Phases 44–49 ("In review"; the table's three columns are Phase | What | State) and CLAUDE.md
   (architecture notes: per-app keys in the Keychain as `connector-key-<id>`; 15 connector tools with MCP `annotations` and `isReadOnly`;
   `runForApp` in `desktop/bots/index.cjs`; `webhooks.cjs` + `shared/webhook-model.mjs` (ntfy for stickies in); `shortcuts.cjs` +
   `shared/shortcut-file.mjs` + `scripts/shortcuts-check.cjs`; `mcp-client.cjs` + `ask-apps.cjs`; the agent; the brief). Update the resume checkpoint.
5. Push, open **one draft PR** to `main` with a plain-English summary, "How to try it" and a short Mac checklist (below). Nate tries the DMG CI builds and says "merge".

## Mac checklist for Nate (things only his Mac can check)

- Settings → Bots → Connector: his old Claude Code setup still works and shows as "First app"; add a "Can look" app and confirm it can't change anything.
- Webhooks: send a test to a Slack/Discord address; `curl -d "Buy milk" <address>` adds a sticky to Unsorted.
- Siri and Shortcuts card: "Add to Shortcuts" for each of the six (signing worked headlessly in `scripts/shortcuts-check.cjs`; Nate's click in Shortcuts is the real test).
- Apps OSAT can use: Import from Claude Desktop, turn one on, Check shows its tools.
- Ask: "move my garden stickies into Garden", "what's on my calendar tomorrow", confirm steps show, one Undo restores.
- Morning brief: turn on in Settings → AI, "Write it now".

## Known gaps (honest)

- Google Calendar / Gmail style OAuth sign-in is not supported by the MCP client; only apps that connect by web address with a key, or a local command (imported from Claude Desktop).
- Webhook deliveries waiting while offline are kept in memory only.
- Full app (Electron) and `npm run test:e2e` were never run by Claude this round; only unit tests, the build, and the headless UI smoke.

## Rules to keep

Nate is new to git; Codex runs the repo (one branch/PR per phase, never merge until he says "merge"). Plain words, "topic" not node and "canvas" not Sky on screen, display the name `OSAT` only, calm rules. Headless testing only: never take over his screen, never open the real app against `~/Library/Application Support/OSAT`.
