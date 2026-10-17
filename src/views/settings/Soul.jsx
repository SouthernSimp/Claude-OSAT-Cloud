import { useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'

import { CalendarChoice } from '../../intake/CalendarChoice.jsx'
import { datesSettings, setDates } from '../../intake/dates.js'
import { autoFileSettings } from '../../sky/auto-file.js'
import { addMemory, forgetMemory, memoryOf, setSoul, soulOf } from '../../soul.js'
import { Choice, Group, Page, Row } from './parts.jsx'

/* Settings → Soul and memory (Phase 70, the mockup's fourth screen): SOUL.md, MEMORY.md and RULES.md. The AI reads
   the first two before every answer (soul.js); RULES.md is the two switches that decide what it does on its own. */

const RULE = [['own', 'On its own'], ['ask', 'Ask me']]
const when = (at) => (at ? ` · ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '')

export function SoulPage({ page, workspace, commit, showUndo }) {
  const [soul, setSoulText] = useState(() => soulOf(workspace.settings))
  const [line, setLine] = useState('')
  const memory = memoryOf(workspace.settings)
  const filing = autoFileSettings(workspace.settings)
  const dates = datesSettings(workspace.settings)

  const remember = (event) => {
    event.preventDefault()
    if (!line.trim()) return
    commit((state) => addMemory(state, line))
    setLine('')
  }
  const forget = (item) => {
    const before = memory
    commit((state) => forgetMemory(state, item.id))
    showUndo(`Forgot “${item.text.slice(0, 40)}”`, () => commit((state) => ({ ...state, settings: { ...(state.settings || {}), memory: before } })))
  }
  const setFiling = (on) => commit((state) => ({ ...state, settings: { ...(state.settings || {}), autoFile: { ...(state.settings?.autoFile || {}), on } } }))

  return (
    <Page page={page}>
      <Group title="SOUL.md · who OSAT is and how it talks to you">
        <Row title="In your words" hint="The AI reads this before every answer. It never leaves this Mac." stacked words="soul personality voice tone how it talks">
          <textarea className="soul-text" rows={12} value={soul} aria-label="SOUL.md" spellCheck={false}
            onChange={(event) => setSoulText(event.target.value)}
            onBlur={() => soul !== soulOf(workspace.settings) && commit((state) => setSoul(state, soul))} />
        </Row>
      </Group>

      <Group title="MEMORY.md · what OSAT knows about you">
        {memory.map((item) => (
          <Row key={item.id} title={item.text} hint={`${item.from || 'You told OSAT'}${when(item.at)}`} words="memory remember about you">
            <button type="button" className="outline-button" aria-label={`Forget ${item.text}`} onClick={() => forget(item)}><X /> Forget</button>
          </Row>
        ))}
        {memory.length === 0 && <Row title="Nothing yet" hint="Tell OSAT something below: your name, what you work on, how you like answers." />}
        <Row title="Tell OSAT something to remember" hint="One thing a line. Ask and filing both read it." stacked words="memory remember about you name work add">
          <form className="setting-form soul-form" onSubmit={remember}>
            <input value={line} maxLength={500} placeholder="Notes about the Mac mini kit belong on mccreery.ai" aria-label="Something to remember" onChange={(event) => setLine(event.target.value)} />
            <button className="outline-button" type="submit" disabled={!line.trim()}><Plus /> Remember</button>
          </form>
        </Row>
      </Group>

      <Group title="RULES.md · what OSAT may do without asking" note="Ask me: new stickies wait in Just in with the boards they look like one tap away, and a date waits in Notes → Coming up. Only the AI's own picks ever move, and Undo takes any run back.">
        <Row title="File new stickies" hint="Each sticky goes to its board when you pause." words="auto sort file organize unsorted just in">
          <Choice label="File new stickies" value={filing.on ? 'own' : 'ask'} options={RULE} onChange={(id) => setFiling(id === 'own')} />
        </Row>
        <Row title="Put dates on your calendar" hint="A sticky that names a day goes on your calendar once you stop writing." words="calendar dates events google outlook icloud coming up">
          <Choice label="Put dates on your calendar" value={dates.on ? 'own' : 'ask'} options={RULE} onChange={(id) => commit((state) => setDates(state, { on: id === 'own' }))} />
        </Row>
        {dates.on && (
          <Row title="Calendar for new dates" hint="One on this Mac passes them on to Google, Outlook or iCloud." words="calendar google outlook icloud">
            <CalendarChoice workspace={workspace} commit={commit} />
          </Row>
        )}
      </Group>
    </Page>
  )
}
