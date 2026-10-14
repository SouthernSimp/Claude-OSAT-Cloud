import { useCallback, useEffect, useState } from 'react'

import { CAPTURES, SAVE_TO } from '../../../shared/capture-model.mjs'
import { holderOf } from '../../../shared/launcher-model.mjs'
import { LauncherPage, useLauncher } from './launcher.jsx'
import { Choice, Group, KeyRecorder, Row, Select, Switch } from './parts.jsx'

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
    <LauncherPage page={page} what="In the Mac app: from the ring, the quick bar or a key.">
      {() => <Screenshots />}
    </LauncherPage>
  )
}

const TOOLS = [['cleanshot', 'CleanShot X'], ['mac', 'The Mac’s own']]

function Screenshots() {
  const { bridge, settings, status: keys, save } = useLauncher()
  const [status, look] = useCaptureStatus(bridge, [settings.captures.recent, settings.captures.saveTo, settings.captures.using])
  if (!status) return <Group><Row title="Looking at this Mac…" /></Group>
  const shown = CAPTURES.filter((item) => status.list.includes(item.id))
  const holder = (id) => (combo) => holderOf(settings, { key: combo }, id)
  const installed = status.installed ?? status.cleanshot
  return (
    <>
      <Group title="Take them with">
        {installed ? (
          <Row title="Screenshot tool" hint={status.cleanshot ? 'CleanShot saves and edits them its own way.' : 'Area, window, screen and text. Recording needs CleanShot.'} words="cleanshot screenshot record installed mac own tool">
            <Choice label="Take screenshots with" value={status.cleanshot ? 'cleanshot' : 'mac'} onChange={(using) => save({ captures: { using } })} options={TOOLS} />
          </Row>
        ) : (
          <Row title="The Mac’s own screenshots" hint="Install CleanShot X for recording and scrolling shots." words="cleanshot screenshot record installed">
            <button className="outline-button" type="button" onClick={() => look(true)}>Look again</button>
          </Row>
        )}
        {!status.cleanshot && status.mac && (
          <>
            <Row title="Save to" words="folder clipboard desktop pictures location">
              <Select label="Where screenshots go" value={settings.captures.saveTo} onChange={(saveTo) => save({ captures: { saveTo } })} options={SAVE_TO} />
            </Row>
            {status.screen !== 'granted' && (
              <Row title="Allow screen recording" hint="Until then, a screenshot shows only your desktop. System Settings → Privacy & Security → Screen Recording." words="permission screen recording privacy" />
            )}
          </>
        )}
        {status.cleanshot && (
          <Row title="Recent captures in the quick bar" hint="Type “screenshots” to find, open or drag them." words="recent history drag cleanshot quick search">
            <Switch label="Show recent captures in the quick search" checked={settings.captures.recent} onChange={(recent) => save({ captures: { recent } })} />
          </Row>
        )}
      </Group>
      {shown.length > 0 && (
        <Group title="Keys">
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
