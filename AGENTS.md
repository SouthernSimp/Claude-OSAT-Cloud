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
