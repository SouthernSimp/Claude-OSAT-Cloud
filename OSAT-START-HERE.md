# OSAT V2

A private place to think, organize, and take the next step. Notes and the Mindmap are the heart of this version: folders, tags, pins, links between notes, and a desk of sticky cards that stays in sync with everything you write. AI runs on your Mac and helps when you invite it.

## Open

Double-click **Open OSAT Field.command**. It opens the private preview at http://127.0.0.1:5237/. This folder does not launch or change the installed OSAT V2 app.

## Try it

1. Open Notes. Make a folder from the sidebar, then a note inside it. Type `#` to tag it and `[[` to link another note — the details panel shows what links back.
2. Switch the editor to Read and tick a checklist item. Today picks it up as a next step.
3. Open Mindmap. Every note is already a card on the Desk. Press **S** to sort the desk into a frame per tag, drag a card's edge onto another to connect them, and double-click the desk to jot a new note in place.
4. In Notes, choose a folder's menu → **Open as board** to get a board that only shows that folder.
5. Press ⌘K to search notes, tags, folders and boards; ⌘\ collapses the sidebar when you want the room.

"Explore a sample day" on Today adds clearly labelled sample folders and linked notes without replacing anything.

## What is real now

Folders, pins, archive, trash, wikilinks and backlinks, the Markdown editor, the native Mindmap with boards, frames, views and tag colours, local AI, capture, projects, focus, habits, reflection, and workspace backup all work locally. Nothing leaves the Mac. Chat history stays in its own local database and is excluded from workspace backups unless you save a reply as a note.

Cross-device sync, iPhone/iPad inference and App Store distribution are not implemented.

## Verification

54 unit checks (`npm test`) cover the notes model, folders, wikilinks, editor commands, board layout and migration, data integrity, the platform bridge and local AI. `node tests/offline-qa.mjs` launches the packaged app offline in an isolated data folder, creates a folder, a linked note and a task, places a card from the Mindmap composer, sorts by tag, and reads the local database back.
