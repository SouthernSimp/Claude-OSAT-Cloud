# OSAT design QA

- Source behavior reference: `qa/osat-implementation/sorter-board-reference-light-1440x900.png`
- Source brand reference: `qa/osat-implementation/mccreery-brand-reference-1440x900.png`
- Desktop implementation: `qa/osat-implementation/osat-today-light-1440x900.jpg`
- Mindmap implementation: `qa/osat-implementation/osat-mindmap-1440x900.jpg`
- Mobile implementation: `qa/osat-implementation/osat-mobile-390x844.jpg`
- Same-viewport combined input: `qa/osat-implementation/comparison-full.png`
- Desktop comparison viewport: 1440 × 900 CSS/image pixels
- Mobile viewport: 390 × 844 CSS pixels

## Visual result

The final comparison keeps the sorter's spatial board, colored records, tag rail, zoom controls, persistent composer, and restrained density while applying the mccreery.ai family: mineral-white surfaces, ink navigation, cobalt actions, system-first typography, thin borders, and low elevation. Light and automatic dark modes share the same hierarchy. No custom cursor or decorative fake asset is used.

Intentional differences from the sorter are product requirements: the OSAT rail exposes the complete operating system, Mindmap cards reference canonical notes/captures/ideas/projects instead of owning duplicate note data, and the inspector explains the selected shared record. Existing user text remains byte-preserved even when it contains the retired technical name.

## Interaction and responsive evidence

- Capture dialog opens with stable autofocus and focus containment; a typed capture persisted into Inbox.
- Markdown blocks visual mode when round-tripping would change bytes and allows a supported heading/bold fixture; the visual edit saved back to raw Markdown.
- Mindmap multiselect, explicit Link, Tidy, undo/redo, Fit, zoom, and import/export dialog focus return were exercised in the browser.
- Budget stored `-12.50` as `-$12.50`; malformed quoted CSV produced zero rows and kept Confirm import disabled.
- Calendar exposes local ICS plus per-event Google, Outlook, and Apple/ICS actions. The in-app automation surface could not commit a native `datetime-local` value, so the serializer/provider paths are covered by executable tests instead of a synthetic browser mutation.
- Obsidian is export-only on web and states that no vault scan or silent synchronization occurs.
- Gmail remains visibly disconnected and its connection control is disabled.
- At 390 × 844, the sidebar becomes the four-item Today/Capture/Notes/More bar; every module remains reachable through More, bottom targets are 58 px tall, and document width does not overflow the viewport.
- Browser console warnings/errors: none.

## Comparison pass

1. The first fitted Mindmap capture reduced seven cards to 57%, leaving too much unused canvas.
2. One native zoom step produced a balanced 72% frame with all cards, filters, inspector, and composer visible.
3. The light sorter reference replaced the dark capture so behavior and density could be judged without a theme mismatch.
4. Final combined inspection found no actionable P0, P1, or P2 visual issue.

final result: passed
