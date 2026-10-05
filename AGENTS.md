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
