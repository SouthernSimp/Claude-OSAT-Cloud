# Phase 80 Connections review

Source screenshot: Nate's supplied image at `/Users/nate/Library/Application Support/OSAT/clipboard/images/cf8e9fe9-004e-4a2a-990e-71600f0f17fa.png`.
It shows the current dark Connections page midway down, mixing AI keys, app controls and incoming connector setup.
This is starting-screen evidence only; no claim of a live OAuth, permissions or accessibility audit is made.

Selected design target: `/Users/nate/.codex/generated_images/01a14b1b-0457-7b10-9b38-d8ad1a24c919/exec-fdfa70a5-93f1-4b1a-99f9-36270d5f619e.png`,
generated from that screenshot and displayed in Nate's conversation. Nate delegated the choice and asked for
elegant, simple and understandable software.

Viewport planned for CI: 1440 × 900 at device scale 1, plus 820 × 760. The source concept is 1586 × 992, with the
same approximately 1.6:1 aspect ratio. Compare relative proportions at 1440 × 900, not unnormalized pixel positions.

## Findings and implementation

1. The starting screen had three different directions of connection mixed together. Apps OSAT uses are now first;
   other apps using OSAT and automation are separate optional disclosures.
2. Addresses, tool names, Check, sign-in and Remove crowded every app row. They now open from the app's name.
   On/off and Needs attention remain visible. These labels report enabled/error state, never invented live availability.
3. Provider keys lived beside app connections. Model choice and providers now live under AI, with the key form closed
   until Connect a provider. Error directions and the Connections → AI link lead to the new location.

## Fidelity surfaces to check against CI captures

- Fonts: existing system/SF tokens and Mac settings hierarchy; CI uses its system fallback.
- Spacing: preserve the Settings rail and page anatomy, grouped app rows, one primary Connect action and two optional
  disclosure rows. Details and the picker must fit narrow space without losing controls.
- Colors: existing light/dark surfaces, subtle borders and the Mac accent.
- Assets: the concept's suggested app glyphs are represented by installed Phosphor icons. No fake service logos,
  new raster artwork or embedded screenshot UI is used.
- Copy: short starting screen, honest on/off/offline/error labels, explicit external-change approval and OAuth enablement.
  Full setup and permission details remain available on demand.

## Validation

All 993 unit tests and production build pass locally. The browser test script passes syntax checking. Native
bridges are faked in the new CI-only test; it covers toggles, checks, sign-in, removal/Undo, selected imports,
custom commands, offline controls, read-only sharing, model/provider setup and focus. It collects page errors.
Real account sign-in, Keychain, installation and native windows were not touched or tested locally.

Implementation screenshots, full-view and readable-region comparison, and responsive review await CI.

final result: blocked
