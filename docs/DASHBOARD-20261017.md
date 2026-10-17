# A business dashboard for OSAT

Nate asked for the look and functionality in [Jack Roberts' dashboard video](https://www.youtube.com/watch?v=xpfuSPG71XI),
without the Jev integration, and asked to install the repositories in [his tools video](https://www.youtube.com/watch?v=zwQmodmp1To).

## What the reference actually shows

The first video's YouTube description and chapter list were read directly. Its storyboard frames were downloaded
and inspected, including the dashboard, inbox and chat views. The visual direction is a dark workspace, compact
navigation, colored accents, compact summary cards and grouped work. This was a visual/source review, not runtime
access to the author's app. REA is unnecessary to analyze video frames; there is no supplied application artifact.

The demonstrated workflows include inbox classification (2:45), voice request routing (3:11), a Fish Audio voice
(4:18), generating and choosing visuals (5:53–7:46), invoice review (9:23), image search by meaning (10:18), and
design checks/lead scoring (11:14). They are distinct workflows, not functionality a dashboard layout provides.

## Phase 81

Today is the first usable slice: daily overview links, boards with real Board progress, recent work, shortcuts
to Mail/Meetings/Files, and agenda links to the actual calendar or sticky. Boards keep their order. The first
three show initially; All shows the rest. Recent work excludes deleted notes and journal pages. Original writing,
folders, stages and geometry stay in place. Existing to-do Undo, habits, goals and money remain.

This phase uses existing source data and navigation. It grants no new app permissions, connects no new accounts,
starts no background AI work and adds no dependencies. It works without connecting an AI provider.

## Remaining video functionality

- Inbox triage: Mail already supports reading, searching, asking about a message and drafting replies. Bulk
  classification needs a reviewable proposal and Undo before anything is moved.
- Voice requests: OSAT already has voice input and meeting transcription. Routing a spoken request into a
  previewed business action needs a separate explicit interaction.
- Invoice review: add a document review with source-backed flags and a human decision. Payment is outside this flow.
- Image search: Files and image intake already exist. A private searchable image index needs its own scope and controls.
- Lead scoring and visual selection need real source material and review criteria rather than sample dashboard numbers.

## Local tool setup

All eleven linked GitHub repositories (ten levels plus SlopMonster) are cloned under
`~/Developer/ai-toolkit/`. The local `sources.json` records their commits and `SETUP.md` records installation
and verification. PhotoCraft, Compositor, ego lite and Orca install separately from OSAT, under `~/Applications`.
Skills are installed in the Codex skills directory and REA is registered for Codex. The 21st MCP needs an API key;
Zapier MCP is a hosted account connection rather than a cloneable repo. No browser sessions were imported and no
new external account access was granted. These tools are not bundled into OSAT.
