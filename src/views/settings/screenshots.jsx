import { useCallback, useEffect, useState } from 'react'

import { CAPTURES, SAVE_TO } from '../../../shared/capture-model.mjs'
import { holderOf } from '../../../shared/launcher-model.mjs'
import { LauncherPage, useLauncher } from './launcher.jsx'
import { Group, KeyRecorder, Row, Select, Switch } from './parts.jsx'

/* Settings → Launcher → Screenshots: screenshots and screen recording from the ring, the quick search or a key.
   With CleanShot X on this Mac, OSAT asks it for each one; without it, the Mac's own screenshots, saved to a folder or
   the clipboard. The settings live with the launcher's (`captures` in launcher.json). */

/* What this Mac can do: { cleanshot, mac, list, recent, saveTo, screen }. `again` looks for CleanShot afresh. */
export function useCaptureStatus(bridge, deps = []) {
  const [status, setStatus] = useState(null)
  const look = useCallback((again = false) => bridge?.captureStatus?.(again).then(setStatus, () => {}), [bridge])
  useEffect(() => { look() }, [look, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return [status, look]
}

/* The ring's "Add a tool" (Settings → The ring): a screenshot is offered only when this Mac can take it. */
export function AddRingTool({ bridge, rest, onAdd }) {
  const [status] = useCaptureStatus(bridge)
  const tools = rest.filter((item) => !item.capture || status?.list.includes(item.capture))
  if (!tools.length) return null
  return (
    <Row title="Add a tool" hint="It goes last.">
      <Select label="Add a tool to the ring" value="" onChange={(id) => id && onAdd(id)} options={[['', 'Choose…'], ...tools.map((item) => [item.id, item.label])]} />
    </Row>
  )
}

export function ScreenshotsPage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app, take a screenshot or record your screen from the ring, the quick search, or a key of its own.">
      {() => <Screenshots />}
    </LauncherPage>
  )
}

function Screenshots() {
  const { bridge, settings, status: keys, save } = useLauncher()
  const [status, look] = useCaptureStatus(bridge, [settings.captures.recent, settings.captures.saveTo])
  if (!status) return <Group><Row title="Looking at this Mac…" /></Group>
  const shown = CAPTURES.filter((item) => status.list.includes(item.id))
  const holder = (id) => (combo) => holderOf(settings, { key: combo }, id)
  return (
    <>
      <Group title="How OSAT takes them" note={status.cleanshot ? 'The first time, CleanShot may ask whether OSAT may control it. Say Allow; it asks only once.' : null}>
        <Row
          title={status.cleanshot ? 'With CleanShot X' : 'With the Mac’s own screenshots'}
          hint={status.cleanshot
            ? 'CleanShot X is on this Mac, so OSAT asks it for every screenshot and recording. Where they are saved, and what happens after, is set in CleanShot.'
            : 'CleanShot X isn’t on this Mac, so OSAT takes an area, a window or the whole screen with the Mac’s own tool, and copies the text in an area with the Mac’s own text reading. Recording and scrolling screenshots need CleanShot X.'}
          words="cleanshot screenshot record installed"
        >
          <button className="outline-button" type="button" onClick={() => look(true)}>Look again</button>
        </Row>
        {!status.cleanshot && status.mac && (
          <>
            <Row title="Save screenshots to" hint="A new name each time; nothing is ever written over." words="folder clipboard desktop pictures location">
              <Select label="Where screenshots go" value={settings.captures.saveTo} onChange={(saveTo) => save({ captures: { saveTo } })} options={SAVE_TO} />
            </Row>
            {status.screen !== 'granted' && (
              <Row
                title="Allow OSAT to see other apps"
                hint="macOS asks once, the first time, before OSAT may take a picture of other apps’ windows; until then a screenshot shows only your desktop. If you said no, turn OSAT on in System Settings → Privacy & Security → Screen Recording."
                words="permission screen recording privacy"
              />
            )}
          </>
        )}
        {status.cleanshot && (
          <Row
            title="Recent captures in the quick search"
            hint="Type “screenshots” in the quick search to see CleanShot’s newest captures, open one, or drag it into any app. OSAT only reads CleanShot’s history folder, and only while this is on; macOS may ask you once."
            words="recent history drag cleanshot quick search"
          >
            <Switch label="Show recent captures in the quick search" checked={settings.captures.recent} onChange={(recent) => save({ captures: { recent } })} />
          </Row>
        )}
      </Group>
      {shown.length > 0 && (
        <Group title="Keys" note="Each one is also in the ring (Settings → The ring → Add a tool) and in the quick search: type “screenshot” or “record”.">
          {shown.map((item) => (
            <Row key={item.id} title={item.label} words={item.words}>
              <KeyRecorder value={settings.captures.hotkeys[item.id]} name={item.label} holder={holder(`capture:${item.id}`)} sends={settings.hyper.sends} failed={keys?.keysFailed?.includes(`capture:${item.id}`)} onSet={(hotkey) => save({ captures: { hotkeys: { [item.id]: hotkey } } })} />
            </Row>
          ))}
        </Group>
      )}
      {!status.mac && <Group><Row title="Screenshots work in the Mac app" /></Group>}
    </>
  )
}
