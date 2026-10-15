import { useRef, useState } from 'react'
import { DownloadSimple, Keyboard } from '@phosphor-icons/react'

import { RAYCAST_KEYS, RAYCAST_LEFT_OUT, exportKind, fromRaycastQuicklinks, fromRaycastSnippets, keysPatch, mergeImport } from '../../../shared/raycast-import.mjs'
import { Group, Row } from './parts.jsx'

/* Settings → Keyboard → Bring in from Raycast: Nate's Raycast keys in one press, and Raycast's own Snippets and Quicklinks
   exports (plain JSON) added to OSAT's. Each is one save with one Undo. shared/raycast-import.mjs has the rules. */

/* What the keys patch will change, as it is now: so Undo puts exactly that back. */
function keysBefore(settings) {
  const apps = Object.fromEntries(Object.keys(RAYCAST_KEYS.apps).map((name) => [name, settings.apps?.[name] || null]))
  return {
    apps,
    sources: Object.fromEntries(Object.keys(RAYCAST_KEYS.sources).map((id) => [id, { hotkey: settings.sources[id]?.hotkey ?? null }])),
    selection: { ...settings.selection },
    captures: { hotkeys: { ...settings.captures.hotkeys } },
    windows: { on: settings.windows.on, hotkeys: { ...settings.windows.hotkeys }, aliases: { ...settings.windows.aliases } },
    custom: settings.custom || [],
  }
}

export function RaycastImport({ settings, save, showUndo }) {
  const picker = useRef(null)
  const [said, setSaid] = useState('')

  async function applyKeys() {
    const before = keysBefore(settings)
    await save(keysPatch(settings))
    setSaid('Your Raycast keys are in. Keys the Mac or another app holds were left as they were.')
    showUndo('Brought in your Raycast keys', () => save(before))
  }

  async function readFiles(files) {
    const snippets = []
    const links = []
    let unknown = 0
    for (const file of files) {
      let parsed = null
      try { parsed = JSON.parse(await file.text()) } catch { /* not JSON */ }
      const kind = exportKind(parsed)
      if (kind === 'snippets') snippets.push(...fromRaycastSnippets(parsed))
      else if (kind === 'quicklinks') links.push(...fromRaycastQuicklinks(parsed))
      else unknown += 1
    }
    const merged = mergeImport(settings, { snippets, links })
    const { added, skipped } = merged
    if (!added.snippets && !added.links) {
      setSaid(unknown ? 'Those aren’t Raycast Snippets or Quicklinks exports.' : 'Everything in those files is already here.')
      return
    }
    const before = { snippets: settings.snippets, links: settings.links }
    await save({ snippets: merged.snippets, links: merged.links })
    const parts = [added.snippets && `${added.snippets} snippet${added.snippets === 1 ? '' : 's'}`, added.links && `${added.links} quick link${added.links === 1 ? '' : 's'}`].filter(Boolean)
    setSaid(`Added ${parts.join(' and ')}.${skipped ? ` ${skipped} were already here.` : ''}`)
    showUndo(`Added ${parts.join(' and ')} from Raycast`, () => save(before))
  }

  return (
    <Group title="Bring in from Raycast" note={said || undefined}>
      <Row title="Use my Raycast keys" hint="Hyper A Claude, C Chrome, F Finder, G Granola, M Messages, O Obsidian, P Terminal, S files, K Kill Process, T and H CleanShot, 1–6 windows, N a quick sticky, E AI on selected text." words="raycast keys shortcuts hotkeys import hyper">
        <button className="outline-button" type="button" onClick={() => applyKeys().catch(() => {})}><Keyboard /> Use them</button>
      </Row>
      <Row title="Snippets and Quicklinks" hint="Export from Raycast’s Snippets or Quicklinks, then choose the file." words="raycast snippets quicklinks import export json">
        <button className="outline-button" type="button" onClick={() => picker.current?.click()}><DownloadSimple /> Choose files…</button>
        <input ref={picker} type="file" accept=".json,application/json" multiple hidden onChange={(event) => { readFiles([...event.target.files]).catch(() => setSaid('Those files couldn’t be read.')); event.target.value = '' }} />
      </Row>
      <Row title="Left in Raycast" stacked hint={<ul className="setting-list">{RAYCAST_LEFT_OUT.map((line) => <li key={line}>{line}</li>)}</ul>} words="raycast missing left out" />
    </Group>
  )
}
