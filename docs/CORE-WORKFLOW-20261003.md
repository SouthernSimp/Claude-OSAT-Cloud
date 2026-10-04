# Core workflow review — October 3, 2026

This branch develops the current OSAT continuation source in an isolated checkout.
It is based on the AI-controls review branch (PR #39), preserving that work.
The older landscape prototype, installed apps, and installed workspace were preserved.

## What changed

- Sky's Unsorted pile is a searchable, dismissible drawer outside the canvas camera.
  Its first page renders 24 stickies, with more on demand. Opening it leaves the
  camera unchanged. Searching an unfiled note reveals it in the drawer.
- Sky search finds nodes, nested branches, note content, and tags. Keyboard arrows
  select a result; Return opens it. Empty results explain what happened.
- Nodes use distinct topic surfaces; stickies retain paper. Focus has a visible
  button and opens large maps at a readable zoom. Existing hand positions remain
  intact. Tidy is still an explicit action.
- Notes titles wrap, previews skip a repeated title, and focused writing hides the
  organizer and list. Escape returns to the normal layout. The idle capture line
  stays behind open rooms, allowing their controls to work.
- Notes and sheets show save status. Rejected batches retain their edits, suspend
  automatic retry, and offer retry or workspace export. A validated temporary
  recovery journal survives reload. Browser saves acknowledge only after the
  IndexedDB transaction completes; unload retains recovery until durable saving.
- Permanent Trash actions require confirmation before their existing Undo flow.
- Sky Ask defaults to the focused topic when there is one. Conversations preserve
  topic/workspace/no-notes scope, show source notes, and disclose an eight-note cap.
  Focused context precedes Unsorted so unrelated captures cannot consume the budget.
- AI unpack returns editable suggestions. Only acceptance creates branches and
  stickies. Undo preserves writing subsequently edited in those new records.
- Opening Sky no longer silently creates the example roadmap. The guide offers it.

## Verified locally

483 unit checks passed. The added cases cover failed saves, reload recovery,
serialized writes and concurrent remote changes, missing acknowledgments,
IndexedDB acknowledgment/abort, 200 unrelated captures, nested topic scope,
no-notes privacy, chat scope persistence, search, and loss-resistant proposal Undo.

The Vite production build passed. Its existing large-bundle warning remains
(about 1.53 MB JS / 444 KB gzip); bundle splitting is separate work.

In-app browser checks used synthetic preview data with more than 300 notes:
drawer search and paging, stable camera on opening, topic/branch search and focus,
wrapping titles, focused writing and Escape, Markdown task changes, immediate
reload recovery and retry, and focused Notes/Sky drawer at a 600px viewport.
Browser review artifacts are saved under `outputs/core-workflow-20261003/`.

## How to try it

The editable preview is http://127.0.0.1:5232/.

1. Open Sky. Toggle Unsorted, search a thought, then close the drawer.
2. Find a node or branch by name. Use a node's focus button, then Done.
3. Open Notes, create a note, write a long title, and use Focus on writing.
   Switch to Read to check Markdown tasks. Escape leaves focused writing.
4. With a local model available, focus a topic and open Ask. Review its scope
   and source notes. A packed topic's AI unpack suggestion can be edited,
   accepted or dismissed; acceptance has Undo.

## Acceptance still needed

No native OSAT/Electron tests were launched on Nate's computer. No installed app
or data was changed. Actual model inference, packaged-app behavior, native file
bridges and physical devices were not retested. Hosted CI supplies broader checks.
The browser has no local model available, so AI prompt/proposal behavior was
validated with pure tests; the live model interaction remains for later acceptance.
Laya was not installed.
