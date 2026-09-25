# NateOS handoff

Updated: August 7, 2026

## What NateOS is

NateOS is Nate's private, local-first second brain. Its core workflow is:

Today → Capture → Inbox → Review → Ideas → Grow → Canvas

Raw captures and their sources stay intact. Organization and AI suggestions must remain reviewable rather than silently rewriting or filing the user's thinking.

## This build conversation

This conversation turned the selected botanical-paper prototype into a working macOS application installed at `/Applications/NateOS.app` without changing production McCreery.ai.

Completed:

- Responsive Paper and After dark themes with persistent choice.
- Persistent spatial canvas with card creation, editing, dragging, panning, zooming, and Fit.
- Native, user-approved file and folder browsing with text preview, path containment, and forget-access controls.
- A draggable hidden-title-bar region with interactive controls excluded from dragging.
- Responsive browser layouts for desktop, iPad, and iPhone widths.
- A visible Build Journal in Projects and an editable summary note on the Canvas.
- An append-only local capture library with persistent Inbox status and bookmarks.
- Dynamic dates and truthful typed-note versus voice-capture presentation.

Verified:

- Production build and compatibility tests.
- Signed macOS bundle, installation, launch, and window movement.
- Theme and canvas persistence across quit and relaunch.
- Native folder browsing, nested text preview, direct-file selection, and access revocation without changing source files.
- Approved-file profile stores only opaque ID, kind, and approved root path; it does not store file contents.

## Recommended next

1. Universal search across preserved captures, notes, ideas, projects, and approved filenames.
2. Portable Markdown/JSON backup and export with attachments.
3. Offline voice capture, local transcription, and human-reviewed AI suggestions.
4. Backlinks, connection explanations, and a weekly review that learns only from explicit choices.

## Boundaries

- Local-first and private by default.
- No cloud sync or production deployment unless explicitly requested.
- Canvas layout is a view; durable records should remain separately exportable.
- No native iOS package, App Store distribution, or notarized public installer yet.
