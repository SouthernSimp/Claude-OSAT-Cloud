import { useEffect, useState } from 'react'
import { LockSimple } from '@phosphor-icons/react'

import { BUTTONS, BUTTON_ACTIONS, SPEED_MAX, SPEED_MIN, SPEED_STEP, wantsHelper } from '../../../shared/mouse-model.mjs'
import { LauncherPage } from './launcher.jsx'
import { Choice, Group, Row, Select, Switch } from './parts.jsx'

/* Settings → Mouse (Phase 64): the mouse wheel scrolls the other way from the trackpad, how fast it scrolls, and what the
   side buttons do. The rules are shared/mouse-model.mjs; the settings are `mouse` in launcher.json; a small helper
   (desktop/launcher/mouse.cjs) does it, only while this is on and OSAT is allowed in Accessibility. */

const DIRECTIONS = [['both', 'Both'], ['vertical', 'Up and down'], ['horizontal', 'Left and right']]
const TRACKPAD = [['none', 'As the Mac has it'], ['vertical', 'Reverse up and down'], ['horizontal', 'Reverse left and right'], ['both', 'Reverse both']]

const directionOf = (axes) => (axes.vertical && axes.horizontal ? 'both' : axes.vertical ? 'vertical' : axes.horizontal ? 'horizontal' : 'none')
const axesOf = (direction) => ({ vertical: direction === 'both' || direction === 'vertical', horizontal: direction === 'both' || direction === 'horizontal' })
const speedWords = (speed) => (speed === 1 ? 'Normal' : `${speed}×`)

/* A slider that saves when it is let go, not on every step of the drag. */
function SpeedSlider({ value, onCommit }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => { if (draft !== value) onCommit(draft) }
  return (
    <span className="word-field">
      <input type="range" min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} value={draft} aria-label="Mouse wheel speed"
        onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <small>{speedWords(draft)}</small>
    </span>
  )
}

export function MousePage({ page }) {
  return (
    <LauncherPage page={page} what="In the Mac app: scroll direction, speed and side buttons.">
      {(launcher) => <Mouse {...launcher} />}
    </LauncherPage>
  )
}

function Mouse({ settings, save, status, bridge, look }) {
  const mouse = settings.mouse
  const set = (patch) => save({ mouse: patch }).then(() => setTimeout(look, 800))
  const reversing = mouse.reverse.mouse.vertical || mouse.reverse.mouse.horizontal
  const allowed = status?.accessibility === 'granted'
  const helper = status?.mouse
  const working = wantsHelper(mouse)

  const state = !mouse.on ? 'Off: OSAT leaves your mouse alone.'
    : !working ? 'On, with nothing to change yet.'
      : helper === 'listening' ? 'On: your changes are working.'
        : helper === 'access' || !allowed ? 'Waiting for Accessibility: allow OSAT below, then come back here.'
          : helper === 'denied' ? 'macOS wouldn’t let OSAT watch the mouse. After an OSAT update it can forget the permission even though OSAT still shows in the list: select it in Accessibility, press −, press Allow below, then turn this off and on.'
            : helper === 'missing' ? 'This build of OSAT doesn’t have the mouse helper, so nothing changes. A build made from source needs “npm run build:helpers” first.'
              : helper === 'failed' ? 'The helper couldn’t start. Turn this off and on to try again.' : 'Starting…'

  return (
    <>
      <Group title="Scrolling" note="Only the mouse wheel changes; the trackpad stays as it is.">
        <Row title="Reverse mouse wheel scrolling" hint={reversing ? (mouse.on ? 'The wheel scrolls the opposite way. Your trackpad stays as it is.' : 'Set, but paused: Mouse changes are off below.') : 'Turn on to make the wheel scroll the opposite way from your trackpad.'} words="reverse invert natural wheel opposite direction windows">
          <Switch label="Reverse mouse wheel scrolling" checked={reversing} onChange={(on) => set({ ...(on ? { on: true } : {}), reverse: { mouse: axesOf(on ? 'both' : 'none') } })} />
        </Row>
        {reversing && (
          <Row title="Which way" hint="Up and down is the usual wheel. Left and right is a tilt wheel, or Shift with the wheel." words="axis vertical horizontal direction">
            <Choice label="Which directions to reverse" value={directionOf(mouse.reverse.mouse)} options={DIRECTIONS} onChange={(direction) => set({ reverse: { mouse: axesOf(direction) } })} />
          </Row>
        )}
        <Row title="Mouse wheel speed" hint="How far one click of the wheel scrolls. The trackpad is never sped up." words="scroll speed faster slower acceleration">
          <SpeedSlider value={mouse.speed} onCommit={(speed) => set({ speed })} />
        </Row>
        <Row title="Trackpad scrolling" hint="Leave this alone unless you want the trackpad to scroll the other way too." words="trackpad natural reverse">
          <Select label="Trackpad scrolling" value={directionOf(mouse.reverse.trackpad)} options={TRACKPAD} onChange={(direction) => set({ reverse: { trackpad: axesOf(direction) } })} />
        </Row>
      </Group>
      <Group title="Side buttons" note="Back and forward press ⌘[ and ⌘]. The middle button is left alone.">
        {BUTTONS.map(({ button, label }) => (
          <Row key={button} title={label} hint="What this button does" words="button back forward mouse side thumb remap">
            <Select label={label} value={mouse.buttons[button] || 'default'} options={BUTTON_ACTIONS} onChange={(action) => set({ buttons: { [button]: action } })} />
          </Row>
        ))}
      </Group>
      <Group title="Mouse changes" note="A small helper adjusts the wheel as it passes. It keeps no record and stops when this is off. Needs Accessibility.">
        <Row title="Use these mouse changes" hint={state} words="on off master switch pause accessibility helper">
          <Switch label="Use these mouse changes" checked={mouse.on} onChange={(on) => set({ on })} />
        </Row>
        {mouse.on && working && !allowed && status?.accessibility === 'needed' && (
          <Row title="Allow OSAT in Accessibility" hint="macOS asks once. OSAT asks only when you press the button.">
            <button className="outline-button" type="button" onClick={() => bridge.askAccess().then(() => setTimeout(look, 1500), () => {})}><LockSimple /> Allow…</button>
          </Row>
        )}
      </Group>
    </>
  )
}
