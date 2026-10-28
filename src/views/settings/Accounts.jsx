import { useEffect, useState } from 'react'
import { CalendarCheck, EnvelopeSimple, Plus } from '@phosphor-icons/react'

import { CalendarChoice } from '../../intake/CalendarChoice.jsx'
import { accessLine, accessOf } from '../../../shared/mac-calendar-model.mjs'
import { macError } from '../MacCalendar.jsx'
import { Group, Page, Row } from './parts.jsx'

/* Settings → Mail and calendar (Phase 105): where your mail comes from and where new events go, in one place. Mail is
   picked in the Mail room ("Where's your mail?", which Change opens); calendars are the Mac's own (iCloud, Google,
   Outlook), allowed once. Off the Mac, it says where these live. */
export function AccountsPage({ page, workspace, commit, navigate }) {
  return (
    <Page page={page}>
      <MailGroup navigate={navigate} />
      <CalendarGroup workspace={workspace} commit={commit} />
    </Page>
  )
}

function MailGroup({ navigate }) {
  const bridge = typeof window !== 'undefined' ? window.osatMail : undefined
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!bridge) return undefined
    let live = true
    bridge.status().then((next) => { if (live) setStatus(next) }, () => {})
    return () => { live = false }
  }, [bridge])
  if (!bridge) {
    return (
      <Group title="Mail">
        <Row title="Your mail lives in the Mac app" hint="Gmail, iCloud, Outlook, Yahoo or any mail server." words="mail email gmail icloud outlook yahoo imap provider" />
      </Group>
    )
  }
  const reading = status?.gmail?.connected ? `Gmail${status.gmail.email ? ` · ${status.gmail.email}` : ''}`
    : status?.imap?.connected ? `${status.imap.label} · ${status.imap.email}`
      : status ? 'The Mail app on this Mac, or not set up yet' : 'Looking…'
  return (
    <Group title="Mail" note="OSAT reads your inbox to show it, find any email and suggest to-dos. It never sends, deletes or marks anything. An app password stays in this Mac’s Keychain.">
      <Row title="Where your mail comes from" hint={reading} words="mail email gmail icloud outlook yahoo imap provider app password change inbox">
        <button type="button" className="outline-button" onClick={() => navigate('Mail', { pick: true })}><EnvelopeSimple /> Change…</button>
      </Row>
    </Group>
  )
}

function CalendarGroup({ workspace, commit }) {
  const bridge = typeof window !== 'undefined' ? window.osatMacCalendar : undefined
  const [access, setAccess] = useState(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!bridge) return undefined
    let live = true
    bridge.status().then((status) => { if (live) setAccess(accessOf(status?.events)) }, () => { if (live) setAccess('unavailable') })
    return () => { live = false }
  }, [bridge])
  async function allow() {
    setNotice('')
    try { setAccess(accessOf(await bridge.allow('events'))) } catch (error) { setNotice(macError(error)) }
  }
  const words = 'calendar events google outlook icloud apple default new dates sync'
  return (
    <Group title="Calendar" note="New events and dates go on a calendar on this Mac, so they show wherever it syncs: iCloud, Google or Outlook. Add Google or Outlook to the Mac once in Internet Accounts.">
      {bridge && access !== 'allowed' && (
        <Row title="Your calendars" hint={notice || accessLine(access) || 'Show your iCloud, Google and Outlook calendars, and add events to them.'} words={words}>
          {access === 'notAsked' && <button type="button" className="primary-button" onClick={allow}><CalendarCheck /> Connect my calendars</button>}
        </Row>
      )}
      <Row title="New events and dates go on" hint="Your default calendar is the one the Mac’s Calendar app uses." words={words}>
        <CalendarChoice workspace={workspace} commit={commit} />
      </Row>
      {window.osatMail?.addAccount && (
        <Row title="Add Google or Outlook" hint="Sign in once in System Settings; your calendar and mail come with it." words={`${words} account internet accounts`}>
          <button type="button" className="outline-button" onClick={() => window.osatMail.addAccount()}><Plus /> Add…</button>
        </Row>
      )}
    </Group>
  )
}
