# Guided Unsorted placement — October 5, 2026

Opening Unsorted starts with one active sticky and a tray of five. A related topic
or branch appears beside it, with nearby stickies and a preview of the destination.
Matching tags and words work offline. Ask local AI is an explicit optional action;
a suggestion never moves anything until Place here is clicked.

On Sky, a new topic, Later and recoverable Trash remain available. After placement,
the sticky flies into its destination and folds upward; reduced motion skips this.
Recently placed and Open destination let you revisit and search inside that topic
or branch without losing the current sticky. All stickies opens the optional list.
Closing that list removes it from the inactive view while keeping the sorting batch.

Moves preserve original IDs, Markdown and relationships. Commit-time checks skip
stale selections and missing destinations. Undo restores placement while preserving
later writing and newer moves; new topics remain available. Sorting history lasts
until Sky is unmounted or the page reloads.

## Verification

497 unit checks, production build and the full local browser regression pass.
The browser regression exercises a proposed new topic without creation, explicit
placement in Project Direction / Questions, destination search while retaining
the current sticky, Undo after reopening, and closing the optional list.
Unit checks cover a 200-sticky move, stale selections, missing destinations,
free placement, recoverable Trash and loss-resistant Undo after edits/moves.

Preview: http://127.0.0.1:5232/. Screenshots: test-results/ui/sky-sorting-review.png.
Installed apps and personal data are preserved. Native Mac testing and real-model
inference were not performed locally. Word hints are conservative; browser checks
cannot establish live model quality. The existing large-bundle warning remains.
