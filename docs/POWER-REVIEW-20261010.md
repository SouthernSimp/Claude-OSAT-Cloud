# Power features — October 10 review

Phases 44–49 are combined on `claude/power` for one draft PR and one CI DMG.
Main stays unchanged until Nate says “merge”.

## Review outcome

Reviewed the agent loop, callers in main/preload/Ask, connected-app tool routing,
connector access checks, the brief scheduler, journal writes and Undo. Reviewed
again after the fixes, against the calm rules and the handoff specification.
The intended load is one person on one Mac, with more than one OSAT window.

Fixed before review:

- Both bots conflict sides survive: synchronous tool changes and guarded
  connector Undo, with the read-only `ask` callback added.
- Overlapping Ask runs cannot make duplicate branches from a stale workspace.
- Ask Undo refuses to erase later edits or delete a new branch holding later stickies.
- Stop after Allow resolves still prevents the external change.
- External confirmation shows the complete arguments, including nested values;
  Tab stays inside it, Esc declines, and keyboard focus returns afterward.
- Offline skips external tool discovery and external calls.
- Read-only spoken answers and the brief request noninteractive model loading.
  Native Calendar/Reminders reads only run with existing permission.
- Brief writing preserves leading blank lines; Undo replaces only its block,
  preserving later writing and tags. Edited brief blocks are protected.
- Brief Undo belongs to a specific write, so an old notice cannot undo a new one.
  Automatic brief notices offer Undo too.
- Turning the brief off while it runs, or crossing midnight, prevents the write.
- The brief opt-in says when the selected cloud model receives calendar/journal context.

## Validation

- Power branch before combining: 677 unit tests passed, build passed.
- Combined branch before review fixes: 700 unit tests passed, build passed.
- Final code: 709 unit tests passed, production build passed.
- Headless Ask browser test passed: steps, Allow, Undo, Tab focus, Esc/Not now,
  tools off, model destination, retry and editing. The model and native bridge
  are simulated; this is UI evidence, not real-model or native-app acceptance.
- Full `npm run test:ui` passed: every room in light/dark, filing on its own,
  and Ask. Screenshots are in `test-results/ui/` and are uploaded by CI.
- Build reports the existing large-bundle warning.
- No local Electron, installed app, real data, live webhook delivery, real MCP
  app or live-model inference was tested. CI handles Electron and Mac packaging.

## How to try it

Use the DMG attached to the draft PR's Mac CI run. Keep your normal workspace
backup before trying a new app build. Open Settings → Bots to connect apps;
Settings → AI holds the morning brief switch. Ask shows what it does as steps.

## Mac checklist

- Connector: the old Claude Code setup still works as First app. Add a Can look
  app and confirm it cannot change anything. Check recent changes and Undo.
- Webhooks: send a test to your Slack/Discord address. Turn on incoming stickies,
  then `curl -d "Buy milk" <address>` puts a sticky in Unsorted. This sends words
  through the chosen ntfy relay; it is not an offline-only link.
- Siri and Shortcuts: Add to Shortcuts for all six. Try them in Shortcuts/Siri.
- Apps OSAT can use: Import from Claude Desktop, turn one on, Check lists tools.
- Ask: “move my garden stickies into Garden” and “what's on my calendar tomorrow”.
  Check steps and one Undo. For an external change, try Allow and Esc/Not now.
  Add later writing before Undo and confirm it remains safe.
- Morning brief: enable it in Settings → AI, choose a time and Write it now.
  Add journal writing, write again, Undo: only the brief changes. Check the
  automatic notice offers Open and Undo. No new Mac permission prompt should appear.

## Limits

- MCP connects through an address with a key or a local command; OAuth sign-in
  for services such as Gmail or Google Calendar is not implemented.
- Offline webhook queues are bounded and in memory only; quitting loses them.
- OSAT's one Undo covers OSAT changes only. Undo in another app must happen there.
- Ask Undo lasts for the last ten changing runs until quit. It refuses a run if
  affected records changed later; it does not attempt a partial rollback.
- Brief Undo lasts until the next brief or quit. It preserves later journal edits
  and refuses to undo a brief block edited by hand.

## Checkout

Continue in `/Users/nate/Desktop/Projects/OSAT V2/work/osat-power-review`, a clean
clone of the pushed power branch. The older shared repository refused checkout
because of a damaged duplicate `claude/bar-customize 2` reference. Its refs and
untracked files were preserved. Dependencies are reused from the existing checkout;
no dependency versions changed, and npm ci was not needed for these local checks.
