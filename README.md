# OSAT

A calm, private layer over your Mac. Drop a thought, find anything, see what's next,
and think with an AI that runs on your Mac. Nothing leaves it.

Where this is heading, step by step: [docs/ROADMAP.md](docs/ROADMAP.md).

## Try the latest build

Every pull request builds a Mac app you can try before anything is merged.

1. Open the pull request on GitHub, then its **Checks** tab, then the **CI** run.
2. Under **Artifacts**, download **OSAT-mac-dmg**. Unzip it and open the DMG.
3. Drag **OSAT** into Applications and open it.
4. Until the app is signed with your Apple Developer ID, macOS will warn that it can't
   check the app. Click **Done**, open **System Settings → Privacy & Security**, scroll
   down and click **Open Anyway** next to OSAT. You only need to do this once per build.

**After that first install, you don't reinstall.** Each merge to `main` is published as a
GitHub release (the newest one is at the repo's Releases page). In OSAT, open **Settings →
About → Check for updates**: it downloads the newest build, swaps the app and restarts it.
Your notes aren't touched and the old app is kept in `~/Library/Application
Support/OSAT/updates/previous`.

Your notes live in `~/Library/Application Support/OSAT`. If an older app already used a
folder with that name, OSAT renames the old folder to `OSAT (before <date>)` and leaves
it untouched. An older `/Applications/OSAT.app` is renamed to `OSAT (old).app`, never
overwritten.

## Build it on your Mac

Double-click **Update OSAT.command**. It installs what's needed, runs the tests, builds
the app and puts it in `/Applications`.

## For development

```bash
npm ci
npm test          # unit tests
npm run build     # production build of the interface
npm run test:ui   # opens every room in a browser and saves screenshots
npm run dev       # browser preview at http://127.0.0.1:5173
npm run start:mac # run the Mac app from source (uses a separate "OSAT Dev" data folder)
```
