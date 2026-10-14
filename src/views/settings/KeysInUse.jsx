import { useEffect, useState } from 'react'

import { holdersOf, keyGroups } from '../../../shared/keys-model.mjs'
import { keysOf, nameOf } from '../../../shared/launcher-model.mjs'
import { labelOf } from '../../lib/hotkey.js'
import { Caps, KeyRecorder } from './parts.jsx'

/* Settings → Shortcuts → Keys in use: every key already taken (OSAT's, the launcher's, the Mac's own), and a
   box to press a key and hear who has it, so a new key never lands on one that is spoken for. Some apps' keys
   aren't listed anywhere the Mac shares; a key that does nothing is taken by one of those. */
export function KeysInUse({ settings }) {
  const [taken, setTaken] = useState(null)
  const [checked, setChecked] = useState(null)
  useEffect(() => { window.osatDesk?.keys?.().then(setTaken, () => setTaken({ desk: [], mac: [] })) }, [])
  if (!taken) return null

  const launcher = Object.entries(keysOf(settings, { all: true })).map(([id, combo]) => ({ name: nameOf(settings, id), combo }))
  const groups = keyGroups({ desk: taken.desk, launcher, mac: taken.mac })
  const holders = checked ? holdersOf(groups, checked) : []

  return (
    <details className="short-card keys-card">
      <summary>Keys in use</summary>
      <div className="keys-check">
        <span>Press a key to see if it’s free</span>
        <KeyRecorder value={checked} name="the key to check" onSet={setChecked} clearable={false} empty="Press a key" />
        {checked && <small role="status">{holders.length ? `${labelOf(checked)} is ${holders.map((holder) => holder.name).join(' and ')}.` : `${labelOf(checked)} isn’t used by anything OSAT can see.`}</small>}
      </div>
      {groups.map((group) => (
        <div key={group.id} className="keys-group" data-group={group.id}>
          <h4>{group.title}</h4>
          {group.rows.map((row) => <div key={`${row.name}:${row.combo}`} className="keys-row"><span>{row.name}</span><Caps value={row.combo} /></div>)}
        </div>
      ))}
    </details>
  )
}
