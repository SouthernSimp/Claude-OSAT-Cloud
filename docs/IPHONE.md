# OSAT on your iPhone

The iPhone app shows the same notes as OSAT on your Mac, kept in step through your
own iCloud Drive. It has three pages: **Today** (drop a thought or a next step, tick
off what's next, see Unsorted), **Notes** (search and write), and **iCloud** (whether
it's in step with your Mac).

## Put it on your iPhone (once)

1. Open **Xcode** once and agree to its license when it asks.
2. In Terminal, in the OSAT folder:
   ```bash
   brew install xcodegen
   npm run ios
   ```
   Xcode opens the OSAT iPhone app.
3. Plug in your iPhone. In Xcode, click **OSAT** in the left column → **Signing &
   Capabilities** → pick your team (your Apple Developer account).
4. Press **Run** (the triangle). The first time, on the iPhone allow it in
   **Settings → General → VPN & Device Management**.

## Keep it in step with your Mac

On the Mac: **OSAT → Settings → iPhone → Use iCloud Drive**. Open the app on the
iPhone; within a minute or so of iCloud syncing, your notes arrive. From then on,
changes go both ways. The Mac moves its OSAT folder into the app's iCloud folder
the first time it sees it (both show in Files as "OSAT").

## How it works (for Claude)

- `ios/` is a small SwiftUI app (`project.yml` for XcodeGen). `WebView.swift` shows the
  built web app from the app bundle through an `osat://` scheme with `?surface=phone`;
  `NativeBridge.swift` answers the page: the app's own files (`workspace.json`,
  `sync.json`) and the OSAT folder in the app's iCloud container (list/read/write, with
  iCloud placeholders downloaded on demand), and tells the page when iCloud brings files.
- The page (`src/surfaces/Phone.jsx`, `phoneBridge` in `src/store/bridges.js`) runs the
  same store and sync engine as the Mac (`shared/sync-engine.mjs`).
- CI builds the app for the simulator (no signing) and attaches a screenshot to each PR.
- Later: TestFlight from CI (needs an App Store Connect API key as a GitHub secret), and
  Ask on the phone.
