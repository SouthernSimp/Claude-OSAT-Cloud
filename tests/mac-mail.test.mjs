import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const { SCRIPT, osascriptArgs, createMacMail } = createRequire(import.meta.url)('../desktop/mac-mail.cjs')

/* The room's channels with a stand-in for osascript: nothing here ever starts it or touches the real Mail. */
async function setup(answer, { platform = 'darwin', installed = () => true } = {}) {
  const handlers = new Map()
  const calls = []
  await createMacMail({
    sharedModule: (name) => import(`../shared/${name}`),
    handle: (channel, operation, options) => handlers.set(channel, { operation, options }),
    fail: (message) => { throw new Error(message) },
    platform,
    installed,
    run: async (command, args) => {
      calls.push([command, args])
      const result = typeof answer === 'function' ? answer(command, args) : answer
      if (result instanceof Error) throw result
      return JSON.stringify(result)
    },
  })
  return { call: (channel, ...args) => handlers.get(channel).operation(...args), handlers, calls }
}

test('every channel is for the desk and the quick bar only, and the list is the whole surface', async () => {
  const { handlers } = await setup([])
  assert.deepEqual([...handlers.keys()].sort(), ['mail:allow', 'mail:list', 'mail:open', 'mail:read', 'mail:reply', 'mail:search', 'mail:status'])
  for (const { options } of handlers.values()) assert.deepEqual(options, { from: 'app' })
})

test('the command line is one fixed script and the rest is data', () => {
  const nasty = { query: 'x"); $.system("rm -rf ~"); `\n\'', id: 5 }
  const args = osascriptArgs('search', nasty)
  assert.deepEqual(args.slice(0, 4), ['-l', 'JavaScript', '-e', SCRIPT])
  assert.equal(args[4], 'search')
  assert.deepEqual(JSON.parse(args[5]), nasty, 'the words survive exactly, as data')
  assert.equal(args.length, 6)
  assert.equal(osascriptArgs('search', { query: 'other' })[3], osascriptArgs('list', {})[3], 'the script never changes with the words')
})

test('the script reads and replies; it cannot send, delete, move, mark or reach the network', () => {
  assert.doesNotThrow(() => new vm.Script(SCRIPT))
  assert.doesNotMatch(SCRIPT, /\.send\b|\bsend\b|delete|\.move\b|readStatus\s*=[^=]|NSURLSession|curl|https?:\/\/|doShellScript|checkForNewMail|\.eval\b|\beval\(|new Function/)
  assert.match(SCRIPT, /openingWindow: true/)
})

test('status never asks the Mac, and says it is missing off the Mac or without Mail', async () => {
  const off = await setup(() => { throw new Error('should not run') }, { platform: 'linux' })
  assert.deepEqual(await off.call('mail:status'), { available: false })
  const none = await setup(() => { throw new Error('should not run') }, { installed: () => false })
  assert.deepEqual(await none.call('mail:status'), { available: false })
  const mac = await setup(() => { throw new Error('should not run') })
  assert.deepEqual(await mac.call('mail:status'), { available: true })
  assert.equal(mac.calls.length, 0)
})

test('list and search answer clean rows, newest first, 50 at most', async () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ id: i + 1, subject: `Hi ${i}`, sender: 'Sam <sam@example.com>', date: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString(), unread: i % 2 === 0, snippet: 'hello‮ there' }))
  const { call, calls } = await setup(rows)
  const list = await call('mail:list')
  assert.equal(list.length, 50)
  assert.equal(list[0].id, 70)
  assert.equal(list[0].snippet, 'hello there')
  assert.deepEqual(calls[0], ['list', {}])
  const found = await call('mail:search', '  invoice  ', true)
  assert.equal(found.length, 50)
  assert.deepEqual(calls[1], ['search', { query: 'invoice', inside: true }])
  await call('mail:search', 'x', 'yes')
  assert.deepEqual(calls[2], ['search', { query: 'x', inside: false }], 'only a real true searches inside')
})

test('what the window sends is checked before it reaches Mail', async () => {
  const { call, calls } = await setup({ ok: true })
  await assert.rejects(call('mail:search', '   '), /Type a word/)
  await assert.rejects(call('mail:search', { toString() { return 'x' } }), /Type a word/)
  for (const bad of ['5', 0, -3, 1.5, null, '5; quit', { id: 5 }]) {
    await assert.rejects(call('mail:read', bad), /isn’t a message in your inbox/, String(bad))
    await assert.rejects(call('mail:reply', bad), /isn’t a message in your inbox/, String(bad))
    await assert.rejects(call('mail:open', bad), /isn’t a message in your inbox/, String(bad))
  }
  assert.equal(calls.length, 0)
  assert.equal(await call('mail:reply', 12), true)
  assert.equal(await call('mail:open', 12), true)
  assert.deepEqual(calls, [['reply', { id: 12 }], ['open', { id: 12 }]])
})

test('a search with quotes, backticks and new lines travels as one line of data', async () => {
  const { call, calls } = await setup([])
  await call('mail:search', 'a"b`c\nd\r\ne\'f$(x)')
  assert.deepEqual(calls[0], ['search', { query: 'a"b`c d e\'f$(x)', inside: false }])
})

test('a message opens with its text cleaned and capped, and a missing one says so', async () => {
  const { call } = await setup((command) => (command === 'read'
    ? { id: 4, subject: 'S', sender: 'a@b.co', date: '2026-10-13T10:00:00Z', unread: false, body: `Hello​\n${'x'.repeat(40000)}` }
    : { error: 'gone' }))
  const message = await call('mail:read', 4)
  assert.ok(message.body.startsWith('Hello\nxxx'))
  assert.equal(message.truncated, true)
  assert.ok(message.body.length <= 20000)
  const missing = await setup({ error: 'gone' })
  await assert.rejects(missing.call('mail:read', 4), /isn’t in your inbox any more/)
})

test('a Mac that has not allowed it, has no accounts, or is slow answers in plain words', async () => {
  const denied = await setup(new Error('execution error: Not authorized to send Apple events to Mail. (-1743)'))
  await assert.rejects(denied.call('mail:allow'), /OSAT isn’t allowed to control Mail/)
  await assert.rejects(denied.call('mail:list'), /OSAT isn’t allowed to control Mail/)
  const insideScript = await setup({ error: 'Error: Not authorized to send Apple events to Mail. (-1743)' })
  await assert.rejects(insideScript.call('mail:list'), /OSAT isn’t allowed to control Mail/)
  const empty = await setup({ error: 'noAccounts' })
  await assert.rejects(empty.call('mail:list'), /Mail isn’t set up on this Mac/)
  const slow = await setup(new Error('timed out '))
  await assert.rejects(slow.call('mail:list'), /took too long/)
  const odd = await setup(new Error('spawn osascript ENOENT /Users/nate/private'))
  await assert.rejects(odd.call('mail:list'), (error) => /couldn’t be reached/.test(error.message) && !/private/.test(error.message))
  assert.deepEqual(await (await setup({ status: 'allowed' })).call('mail:allow'), { status: 'allowed' })
})

/* The script itself, run in a sandbox against a stand-in for Mail's scripting: it proves the script's own
   logic (caps, order, how a search is built) without ever starting osascript or opening the real Mail. */
function fakeMail(messages, { accounts = 1 } = {}) {
  const seen = { whose: [], replies: [], opened: [], activated: 0 }
  const specifier = (m) => ({
    id: () => m.id, subject: () => m.subject, sender: () => m.sender, dateReceived: () => new Date(m.date),
    readStatus: () => m.read !== false, content: () => m.body ?? 'Body of ' + m.subject, messageId: () => m.mid ?? `<m${m.id}@example.com>`,
  })
  const setOf = (list) => {
    const set = list.map(specifier)
    set.dateReceived = () => list.map((m) => new Date(m.date))
    set.whose = (criteria) => {
      seen.whose.push(criteria)
      const test = (m, c) => {
        if ('id' in c) return m.id === c.id
        if (c.dateReceived) return new Date(m.date) > c.dateReceived._greaterThan
        if (c._or) return c._or.some((one) => test(m, one))
        const [field, op] = Object.entries(c)[0]
        return String(field === 'content' ? m.body ?? '' : m[field]).includes(op._contains)
      }
      return setOf(list.filter((m) => test(m, criteria)))
    }
    return set
  }
  const Mail = {
    accounts: { length: accounts }, inbox: { messages: setOf(messages) },
    reply: (m, options) => seen.replies.push([m.id(), options]), activate: () => { seen.activated += 1 },
  }
  const me = { openLocation: (url) => seen.opened.push(url) }
  const Application = Object.assign(() => Mail, { currentApplication: () => me })
  const run = vm.runInNewContext(`${SCRIPT}\nrun`, { Application })
  // What the sandbox made is read back through JSON, so it compares with this file's own objects.
  const copy = (value) => JSON.parse(JSON.stringify(value))
  return { go: (command, args = {}) => JSON.parse(run([command, JSON.stringify(args)])), seen: { get whose() { return copy(seen.whose) }, get replies() { return copy(seen.replies) }, get opened() { return copy(seen.opened) } } }
}

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString()

test('the script: the newest fifty whatever order Mail keeps them in, with snippets', () => {
  const messages = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, subject: `Mail ${i}`, sender: 'a@b.co', date: hoursAgo(i + 1), read: i % 3 !== 0 }))
  messages.reverse() // oldest first: the script must not trust Mail's order
  const { go } = fakeMail(messages)
  const list = go('list')
  assert.equal(list.length, 50)
  assert.equal(list[0].id, 1, 'the newest comes first')
  assert.equal(list[49].id, 50)
  assert.equal(list[0].unread, true)
  assert.equal(list[1].unread, false)
  assert.equal(list[0].snippet, 'Body of Mail 0')
  assert.equal(Object.hasOwn(list[0], 'body'), false, 'a list never carries whole bodies')
})

test('the script: a quiet inbox of old mail still lists it; no accounts says so; no Apple event goes beyond reading', () => {
  const old = [{ id: 1, subject: 'Old', sender: 'a@b.co', date: '2020-01-01T00:00:00Z' }]
  assert.equal(fakeMail(old).go('list').length, 1)
  assert.deepEqual(fakeMail(old, { accounts: 0 }).go('list'), { error: 'noAccounts' })
  assert.deepEqual(fakeMail(old, { accounts: 0 }).go('allow'), { error: 'noAccounts' })
  assert.deepEqual(fakeMail(old).go('allow'), { status: 'allowed' })
  assert.deepEqual(fakeMail(old).go('nonsense'), { error: 'unknown' })
})

test('the script: a search with quotes, backticks and new lines is only ever matched as text', () => {
  const nasty = 'x"); throw new Error("pwned"); (`\n\'${evil}'
  const { go, seen } = fakeMail([
    { id: 1, subject: `Re: ${nasty}`, sender: 'a@b.co', date: hoursAgo(2) },
    { id: 2, subject: 'Lunch', sender: 'Sam <sam@example.com>', date: hoursAgo(1), body: 'the invoice is attached' },
  ])
  assert.deepEqual(go('search', { query: nasty }).map((m) => m.id), [1])
  assert.deepEqual(seen.whose.at(-1)._or[0], { subject: { _contains: nasty } })
  assert.equal(seen.whose.at(-1)._or.length, 2, 'subject and sender only, unless asked to look inside')
  assert.deepEqual(go('search', { query: 'sam@' }).map((m) => m.id), [2])
  assert.deepEqual(go('search', { query: 'invoice' }).map((m) => m.id), [])
  assert.deepEqual(go('search', { query: 'invoice', inside: true }).map((m) => m.id), [2])
  assert.equal(seen.whose.at(-1)._or.length, 3)
})

test('the script: read gives the text only; reply opens a window and never sends; open uses the message link', () => {
  const { go, seen } = fakeMail([{ id: 9, subject: 'Hello', sender: 'a@b.co', date: hoursAgo(1), body: '<b>hi</b> https://x.example', mid: '<abc@mail.example.com>' }])
  const message = go('read', { id: 9 })
  assert.equal(message.body, '<b>hi</b> https://x.example')
  assert.deepEqual(go('read', { id: 10 }), { error: 'gone' })
  assert.deepEqual(go('reply', { id: 9 }), { ok: true })
  assert.deepEqual(seen.replies, [[9, { openingWindow: true }]])
  assert.deepEqual(go('open', { id: 9 }), { ok: true })
  assert.deepEqual(seen.opened, ['message://%3Cabc%40mail.example.com%3E'])
  assert.deepEqual(go('reply', { id: 99 }), { error: 'gone' })
  assert.equal(seen.replies.length, 1)
})
