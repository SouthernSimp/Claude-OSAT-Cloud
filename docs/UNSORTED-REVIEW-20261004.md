# Sorting a large Unsorted pile — October 4, 2026

The previous Sky review (PR #40) is merged into `codex/osat-ai-model-controls`.
This sorting pass is on `codex/unsorted-review-20261004`.

Use Sky → Unsorted → Sort stickies in batches in the isolated browser preview at
http://127.0.0.1:5232/. The existing sticky drawer, topic navigator, and canvas are
preserved. Sorting does not move the camera or arrange existing notes.

## Behavior

- A searchable queue shows twenty stickies at a time, with full Markdown reading.
- Select individual thoughts or the visible batch. Selection clears when changing
  batches or searching, so hidden selections cannot accidentally move.
- Choose an existing topic or any nested branch by its full path. Search destinations,
  or explicitly create a new topic and move the selected stickies there.
- Local tags and shared words offer possible groups for the current batch. Reviewing
  one selects the proposed stickies and destination; it does not create or move records.
  Generic overlap with existing note text is insufficient to recommend a destination.
  This flow works offline and does not invoke a model.
- Moves preserve original note IDs, Markdown and relationships. Commit-time checks
  skip notes already filed, deleted, archived, trashed, day pages and intentionally
  placed free stickies. Missing destinations do not move notes back to Unsorted.
- Undo remains available after closing/reopening the drawer during the Sky session.
  It restores placement fields while preserving later writing, new notes and newer
  locations. New topics remain after Undo to preserve any work subsequently put in them.
  Undo history ends when Sky is unmounted or the page reloads.

## Verification

494 unit checks and the production build pass. New regression coverage exercises a
200-sticky move, stale selections, missing destinations, unchanged identities/content/
links/geometry, safe Undo after edits and later moves, and conservative word hints.
Browser review exercised a twenty-sticky move into Ideas / Research, Undo, search for
a sticky near the end of an 81-item synthetic queue, new-topic creation, and pagination.
Narrow-window review at 600×800 confirms equal panel clientWidth and scrollWidth with
the navigator collapsed. The queue and reader scroll within the existing Sky frame.

The complete local browser regression passed, including every existing room and
the Sky import/branch flows. The browser regression also covers review-before-move, nested destination selection,
and Undo after closing/reopening Unsorted. The previous review's checks were repaired
for two-step Escape navigation and visible branch menus. Import now focuses the new
topic after React has received it, fixing hidden imported branches/packed summaries.

No installed app, personal workspace, native Mac tests or real AI inference changed.
The existing build warns about the large application bundle; code splitting remains
separate work. Suggestions are deliberately conservative and are not semantic AI sorting.
