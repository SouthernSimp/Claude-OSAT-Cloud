# Sky Undo and Redo — October 5, 2026

PR #39 (AI controls and earlier Sky/core workflow work) and PR #41 (guided
five-sticky sorting) are merged into main. This next pass is developed in
work/osat-core-improvements on codex/sky-history-20261005, preview port 5232.

Sky now retains the last 100 canvas changes for the current window session.
Undo and Redo stay in the toolbar after a toast disappears and after returning
to the desk, Notes, or another room and reopening Sky. Command-Z and
Shift-Command-Z work while the canvas is focused; writing fields retain their
own text Undo. Opening Unsorted disables the canvas controls so its explicit
Undo last placement remains clear.

History covers existing sticky/topic/branch moves and ordering, hanging cards
within maps, free Sky placement, connections, Tidy and Arrange. A new canvas
change clears Redo. Writing, newly created records, imports, Trash and guided
sorting retain their existing workflows. History ends on reload or app quit;
there is no workspace schema change or new storage key.

Undo restores only canvas fields. Later writing, titles, colors, added records
and unrelated work remain intact. If the relevant placement or connections
changed elsewhere, that group is skipped and a calm notice explains that newer
work was kept. Missing records/destinations, Trash and hierarchy cycles are
protected. Partial Undo produces Redo only for the fields actually restored.
Desk-placement restoration also checks for newer positions before restoring.

## Verification

501 unit checks pass. New checks exercise multi-step moves/arrangement and Redo,
later writing and added records, newer homes/positions/connections, missing and
trashed records, missing destinations and parent cycles. Production build passes
with the existing large-bundle warning. The full browser regression passes,
including toolbar Undo, keyboard Redo, editor shortcut isolation and history after
leaving/reopening Sky; screenshots are in test-results/ui/sky-history.png.
In-app browser checks also confirm Arrange/Undo/Redo restores exact topic
positions and the focused/overview toolbar has equal clientWidth and scrollWidth
at a 600×800 viewport (545px effective CSS width).

Installed apps and personal data are unchanged. No native Mac app was launched
locally and no live inference was performed. Hosted PR CI provides the separate
Electron and Mac build checks; its current status is visible on the PR.
