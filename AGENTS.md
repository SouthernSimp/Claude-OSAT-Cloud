# OSAT implementation guidance

Read `CLAUDE.md` and `docs/ROADMAP.md` for architecture, compatibility, and handoff rules.
Use the in-app browser to open or view links. Preserve the installed app and its
data during development; source tests must use isolated data directories.
Nate asked to stop Mac application testing on his computer. Do not launch native
OSAT/Electron tests here again unless he explicitly requests them. Prefer code-only
checks and CI for further validation.

## October 2, 2026 — AI model and memory controls

- Keep OSAT's built-in local engine. LM Studio remains an optional existing runtime.
- Downloading, selecting, and loading a model are separate actions. Installing all
  three catalog models downloads them sequentially without loading or changing the default.
- Choose Light, Balanced, or Deep per conversation in Ask's model menu. Selection
  loads on the next question; explicit preloading belongs in Settings → AI.
- Remember each conversation's choice and which model produced each reply.
- Load AI at startup is a device preference, initially off. When enabled, load only
  the downloaded default; local startup loading also works offline.
- Replace idle, unretained models by default. A combined native dialog reviews
  resources and reload cost before replacing Balanced/Deep, retaining several,
  or attempting a model with little available memory. Estimates include context;
  unknown estimates must be described honestly. Keep native allocation safeguards.
- Keep loaded lasts for this session, until explicit unload or quit. Other models
  unload after ten idle minutes. Never unload queued or running work.
- Manual unload and Free AI memory keep downloads and chats. Background work
  cannot silently reload a manually unloaded model; an explicit question can.
- Free AI memory belongs in Ask (including its floating window) and the menu bar.
  Report any busy models by name and wait for process exit before reporting unload.
- Preserve canonical records and existing compatibility internals. Do not update
  the installed app as part of interface review; leave merge/install to Nate.

## October 3, 2026 — core workflow continuation

Nate asked for substantial autonomous progress while away, with efficient work
that makes the workspace feel more developed. Continue the existing priorities:
Sky, note taking, and how AI works with those records. Review in a browser first.
Laya was mentioned as something to investigate later, not an installation request.
The isolated review branch is `codex/core-workflow-20261003`, based on the
AI-controls review branch. Keep installed apps and their data preserved.

## October 4, 2026 — professional Sky workspace

Nate asked to fix Sky's appearance and make it professional and developed for
working with many notes, and to provide a prioritized list of remaining fixes.
Favor readable content, clear navigation and predictable capture over decorative
motion. The review implementation separates the topic overview from focused maps,
keeps Unsorted optional, and makes arrangement explicit with Undo. Preserve note
identities, relationships and hand-placed geometry; don't automatically arrange
the workspace. Continue browser review at 127.0.0.1:5232.

## October 4, 2026 — sorting a large Unsorted pile

Nate authorized merging the previous Sky review and building a practical way to
sort many Unsorted stickies. Keep the current Sky design. Use an optional review
queue with small batches, search, full sticky reading, explicit multi-select and
moves to topics or branches. Local word/tag hints are proposals only. Preserve
canonical notes, writing, relationships and hand-placed geometry. Sorting Undo
must remain available during the Sky session and preserve later edits and moves.
No installed-app update or native Mac testing is authorized by this request.


## October 4, 2026 — sorting review rejected

Nate rejected the list-and-filing-panel sorting screen as confusing, cluttered,
wordy and overwhelming. Twenty visible stickies is too many for this experience.
The goal is a calm, obvious first step for someone who has let thoughts pile up,
without requiring them to choose among existing topics immediately. Putting a
sticky freely onto Sky must be an equal option to filing it. Nate suggested a
visual sorter with five or ten stickies at a time and explicitly asked for
questions before another implementation. Clarify the opening view, how loose
groups become topics, and the amount of optional guidance before rebuilding.
This supersedes the prior sorting UI direction; preserve all existing records.


## October 4, 2026 — single-sticky placement mockups

Nate clarified that sorting should start as soon as Unsorted opens, with attention
on the first sticky. OSAT should surface a related node or branch using the
sticky's content and workspace context so the user never has to browse every
topic. When nothing fits, a proposed new node or a free spot on Sky are equally
valid destinations. He requested visual mockups before implementation. Show a
calm first step with few words and small batches; avoid the rejected filing form.


## October 4, 2026 — combined guided sorting concept

Nate selected a combination of the first and third mockups: a visual tray of five
stickies with the first mockup's assisted placement. A tray that only offers free
placement or making a node is insufficient. For the active sticky, OSAT should
surface the related node or branch and visually show where it would be filed,
without making the user search topics. Keep attention on one sticky and show the
nearby notes that make the recommendation understandable. Preserve free Sky
placement as an alternative. The revised combined mockup is
`outputs/unsorted-concepts-20261004/04-guided-five-sticky.png`; it is a proposal,
not an implemented flow or live-AI result.


## October 4, 2026 — placement and finding your way back

Nate approved implementing the guided five-sticky concept. After an explicit
placement, animate the sticky into its destination and fold it upward toward the
node or branch before showing the next sticky. Reduced motion skips the flight.
Keep a recent-placement trail and a way to reopen the destination without losing
the current sticky or batch. Trash is a recoverable choice with Undo. Search belongs
inside an opened topic or branch rather than on every collapsed node. Immediate
word/tag suggestions and optional explicitly requested local AI should surface
related destinations; never require browsing the whole topic tree. Keep free Sky
placement, Later, canonical notes and loss-resistant Undo. The selected annotated
image is exec-babbbfc9-9e65-4a61-a283-9fc52227da6a.png from this chat.

## October 5, 2026 — autonomous continuation and installation boundary

Nate authorized merging ready reviews and completing the next core implementation
set while away. PRs #39 and #41 are merged into main. Sky session Undo/Redo is the
next review in work/osat-core-improvements on codex/sky-history-20261005, preview
5232. Keep installed apps/data untouched; Nate will request installation later.
The native Mac testing pause continues. Preserve the selected guided sorter design.

## October 5, 2026 — focused Notes AI

Nate authorized focused local AI in Notes: Summarize, Untangle, and Next steps.
Each request explicitly shares the current note; additional notes are selected
opt-in. Review and edit the answer before explicitly saving a separate linked
note. Preserve original writing, later edits, canonical records and Sky geometry.
Use the existing local runtime only, with Stop and honest unavailable/error states.
Keep browser verification in the background when a visible tab is unnecessary.
Installed apps, native testing, networking, merging and deployment remain outside
this implementation. See docs/NOTES-AI-20261005.md.
