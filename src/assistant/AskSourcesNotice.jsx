import { useState } from 'react'

/* Said once, calmly, before Ask first looks at copies and files: what it may read, where it stays, and one way to say no.
   Dismissed for good (per Mac) with either button; "Turn it off" is Settings → Launcher's switch. */
const KEY = 'osat.ask.sources.notice.v1'
const seen = () => { try { return localStorage.getItem(KEY) === '1' } catch { return true } }

export function AskSourcesNotice({ className = 'ask-sources-notice' }) {
  const [gone, setGone] = useState(seen)
  const bridge = typeof window === 'undefined' ? null : window.osatSearch
  if (gone || !bridge?.askFind) return null
  const done = () => { try { localStorage.setItem(KEY, '1') } catch { /* it just shows again */ } setGone(true) }
  return (
    <p className={className} role="note">
      Ask can look at what you copied and at files in your approved places, only on this Mac, and leaves out anything that looks like a password or a key. A cloud model never sees them.
      {' '}<button type="button" onClick={done}>Got it</button>
      {' '}<button type="button" onClick={() => { Promise.resolve(bridge.askSwitch(false)).catch(() => {}); done() }}>Turn it off</button>
    </p>
  )
}
