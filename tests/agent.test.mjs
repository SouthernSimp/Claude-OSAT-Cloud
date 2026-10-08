import assert from 'node:assert/strict'
import test from 'node:test'

import { answerMessages, confirmText, grammarSafe, readStep, runAgent, spoken, stepSchema, summaryOf } from '../shared/agent.mjs'
import { TOOLS } from '../shared/connector-tools.mjs'

/* A model that answers from a script, one line a turn, and remembers what it was shown. */
function scripted(...answers) {
  const seen = []
  const ask = async (messages, options) => {
    seen.push({ messages: messages.map((message) => ({ ...message })), options })
    return answers.length ? answers.shift() : '{"done": true}'
  }
  return { ask, seen }
}

function tool(name, { readOnly = true, external = false, appName, answer = (args) => ({ text: `${name} ran with ${JSON.stringify(args)}` }) } = {}) {
  const calls = []
  return {
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words.' } }, additionalProperties: false },
    readOnly,
    external,
    appName,
    calls,
    run: async (args) => { calls.push(args); return answer(args) },
  }
}

const QUESTION = [{ role: 'system', content: 'You are OSAT.' }, { role: 'user', content: 'Find my garden notes' }]
const use = (name, args = {}, why = 'Looking') => JSON.stringify({ why, use: name, with: args })

test('a tool is used, its answer goes back to the model, then done', async () => {
  const search = tool('search', { answer: () => ({ text: '3 found for “garden”:\n- (note-1) Water the tomatoes' }) })
  const { ask, seen } = scripted(use('search', { query: 'garden' }, 'Looking in your notes for garden'), '{"done": true}')
  const events = []
  const { steps, results } = await runAgent({ ask, tools: [search], messages: QUESTION, onStep: (step) => events.push(step) })
  assert.deepEqual(search.calls, [{ query: 'garden' }])
  assert.deepEqual(steps, [{ id: 'step-1', tool: 'search', app: '', why: 'Looking in your notes for garden', state: 'done', summary: '3 found for “garden”' }])
  assert.deepEqual(events.map((step) => step.state), ['running', 'done'])
  assert.equal(results[0].text, '3 found for “garden”:\n- (note-1) Water the tomatoes')
  // The tools join the one system message; the question is unchanged; each turn carries the schema.
  assert.equal(seen[0].messages.length, 2)
  assert.match(seen[0].messages[0].content, /^You are OSAT\.\n\nYou can use tools[\s\S]*- search: The search tool\.\n {2}Arguments: query \(optional\): Words\./)
  assert.ok(seen[0].options.schema.oneOf)
  const after = seen[1].messages
  assert.deepEqual(after.slice(-2).map((message) => message.role), ['assistant', 'user'])
  assert.equal(after.at(-1).content, 'What search answered:\n3 found for “garden”:\n- (note-1) Water the tomatoes')
  assert.deepEqual(JSON.parse(after.at(-2).content), { why: 'Looking in your notes for garden', use: 'search', with: { query: 'garden' } })
  assert.deepEqual(QUESTION.map((message) => message.role), ['system', 'user'], 'the caller’s messages are left alone')
})

test('it stops after maxSteps, and at a call made twice the same way', async () => {
  const search = tool('search')
  let n = 0
  const endless = async () => use('search', { query: `try ${++n}` })
  assert.equal((await runAgent({ ask: endless, tools: [search], messages: QUESTION, maxSteps: 3 })).steps.length, 3)
  assert.equal(search.calls.length, 3)
  const again = tool('search')
  const { steps } = await runAgent({ ask: scripted(use('search', { query: 'a' }), use('search', { query: 'a' }), use('search', { query: 'b' })).ask, tools: [again], messages: QUESTION })
  assert.equal(steps.length, 1, 'the same call twice ends the run')
})

test('answers are read forgivingly: prose and fences around JSON, braces in strings, other key names, nulls', () => {
  assert.deepEqual(readStep('Sure! ```json\n{"use": "search", "with": {"query": "a {b}"}, "why": "Look"}\n``` hope that helps'), { use: 'search', with: { query: 'a {b}' }, why: 'Look' })
  assert.deepEqual(readStep('{"tool": "search", "arguments": {"query": "x", "limit": null}}'), { use: 'search', with: { query: 'x' }, why: '' })
  assert.deepEqual(readStep('{"why": "say \\"hi\\" }", "use": "search", "with": 5}'), { use: 'search', with: {}, why: 'say "hi" }' })
  for (const text of ['', 'I moved it for you.', '{"done": true}', '{"use": ""}', '{not json}', '[1, 2]', '{"done": true, "use": "search"}']) assert.deepEqual(readStep(text), { done: true }, text)
})

test('an unknown tool or a failing one is a failed step, and the run goes on', async () => {
  const broken = tool('search', { answer: () => { throw new Error('The disk is asleep.') } })
  const { steps, results } = await runAgent({ ask: scripted(use('nope'), use('search', { query: 'x' })).ask, tools: [broken], messages: QUESTION })
  assert.deepEqual(steps.map((step) => [step.tool, step.state]), [['nope', 'failed'], ['search', 'failed']])
  assert.match(results[0].text, /There is no tool called “nope”\. The tools are: search\./)
  assert.equal(results[1].text, 'The disk is asleep.')
})

test('only another app’s changing tool asks first; Not now skips it and the run goes on', async () => {
  const asked = []
  const own = tool('move_sticky', { readOnly: false })
  const looks = tool('calendar.list_events', { external: true, appName: 'Google Calendar' })
  const changes = tool('calendar.create_event', { readOnly: false, external: true, appName: 'Google Calendar' })
  const confirm = async (request) => { asked.push(request); return asked.length === 1 }
  const script = [use('move_sticky', { query: 'seeds' }), use('calendar.list_events'), use('calendar.create_event', { query: 'Dentist' }, 'Adding the dentist'), use('calendar.create_event', { query: 'Gym' }, 'Adding the gym')]
  const { steps, results } = await runAgent({ ask: scripted(...script).ask, tools: [own, looks, changes], messages: QUESTION, confirm })
  assert.equal(own.calls.length, 1, 'OSAT’s own change runs without asking (its Undo is the safety)')
  assert.equal(looks.calls.length, 1, 'looking in another app runs without asking')
  assert.deepEqual(changes.calls, [{ query: 'Dentist' }], 'Allow runs it; Not now doesn’t')
  assert.deepEqual(asked.map((request) => [request.tool.name, request.why, request.stepId]), [['calendar.create_event', 'Adding the dentist', 'step-3'], ['calendar.create_event', 'Adding the gym', 'step-4']])
  assert.deepEqual(steps.map((step) => step.state), ['done', 'done', 'done', 'skipped'])
  assert.equal(steps[3].app, 'Google Calendar')
  assert.equal(results[3].text, 'Nate said not now.')
  // Without anyone to ask, another app's change never runs.
  const lone = tool('calendar.create_event', { readOnly: false, external: true, appName: 'Google Calendar' })
  await runAgent({ ask: scripted(use('calendar.create_event')).ask, tools: [lone], messages: QUESTION })
  assert.equal(lone.calls.length, 0)
  assert.equal(confirmText({ tool: lone, args: { title: 'Dentist', start: '2026-10-09T15:00', notes: null }, why: 'Adding the dentist' }),
    'Ask wants to change something in Google Calendar: Adding the dentist. (title: Dentist, start: 2026-10-09T15:00)')
})

test('Stop ends the run: no more steps, and a model stopped mid-answer is not an error', async () => {
  const controller = new AbortController()
  const search = tool('search', { answer: () => { controller.abort(); return { text: 'found' } } })
  const { steps } = await runAgent({ ask: scripted(use('search', { query: 'a' }), use('search', { query: 'b' })).ask, tools: [search], messages: QUESTION, signal: controller.signal })
  assert.equal(steps.length, 1)
  const stopping = new AbortController()
  const ask = async () => { stopping.abort(); throw Object.assign(new Error('stopped'), { name: 'AbortError' }) }
  assert.deepEqual(await runAgent({ ask, tools: [search], messages: QUESTION, signal: stopping.signal }), { steps: [], results: [] })
  await assert.rejects(runAgent({ ask: async () => { throw new Error('The AI is not set up yet.') }, tools: [search], messages: QUESTION }), /not set up/)
})

test('the schema: one shape per tool plus done, built from the connector’s tools, as the grammar can take it', async () => {
  const own = TOOLS.filter((item) => item.name !== 'ask')
  const schema = stepSchema(own)
  assert.equal(schema.oneOf.length, own.length + 1)
  assert.deepEqual(schema.oneOf.map((item) => item.properties.use?.const).filter(Boolean), own.map((item) => item.name))
  assert.deepEqual(schema.oneOf.at(-1), { type: 'object', properties: { done: { const: true } } })
  const move = schema.oneOf.find((item) => item.properties.use.const === 'move_sticky').properties.with
  assert.deepEqual(move.properties.sticky, { type: 'string' }, 'a required argument stays as it is')
  assert.deepEqual(move.properties.node, { oneOf: [{ type: 'string' }, { type: 'null' }] }, 'an optional one may be null')
  assert.deepEqual(schema.oneOf.find((item) => item.properties.use.const === 'search').properties.with.properties.limit, { oneOf: [{ type: 'integer' }, { type: 'null' }] }, 'minimum and maximum are left out')
  // What other apps' schemas hold that the grammar can't take.
  assert.deepEqual(grammarSafe({ anyOf: [{ type: 'string', format: 'uri', pattern: '^h' }, { type: 'number' }] }), { oneOf: [{ type: 'string' }, { type: 'number' }] })
  assert.deepEqual(grammarSafe({ type: 'object' }), { type: 'object', additionalProperties: true })
  assert.deepEqual(grammarSafe({ type: ['string', 'null'], enum: ['a', 'b', { no: 1 }] }), { enum: ['a', 'b'] })
  assert.deepEqual(grammarSafe({ $ref: '#/$defs/x' }), { type: ['string', 'number', 'boolean', 'null'] })
  assert.deepEqual(grammarSafe({ type: 'array', items: { type: 'string', minLength: 2 } }), { type: 'array', items: { type: 'string' } })

  // node-llama-cpp's own JSON-schema reader (what createGrammarForJsonSchema runs, no model needed).
  const base = new URL('../node_modules/node-llama-cpp/dist/utils/gbnfJson/', import.meta.url)
  let grammar
  try {
    grammar = {
      ...await import(new URL('getGbnfGrammarForGbnfJsonSchema.js', base)),
      ...await import(new URL('utils/validateObjectAgainstGbnfSchema.js', base)),
    }
  } catch {
    return // node-llama-cpp isn't installed here
  }
  assert.match(grammar.getGbnfGrammarForGbnfJsonSchema(schema), /^root ::= /)
  assert.equal(grammar.validateObjectAgainstGbnfSchema({ why: 'Filing it', use: 'move_sticky', with: { sticky: 'note-1', node: 'Garden', branch: null } }, schema), true)
  assert.equal(grammar.validateObjectAgainstGbnfSchema({ done: true }, schema), true)
  assert.throws(() => grammar.validateObjectAgainstGbnfSchema({ use: 'make_coffee', with: {} }, schema))
})

test('the final answer reads what the tools answered; a spoken answer is short and plain', () => {
  const results = [
    { tool: 'search', app: '', why: 'Looking for seeds', state: 'done', text: '1 found' },
    { tool: 'calendar.create_event', app: 'Google Calendar', why: 'Adding the dentist', state: 'skipped', text: 'Nate said not now.' },
  ]
  const messages = answerMessages(QUESTION, results)
  assert.equal(messages.length, 2)
  assert.match(messages[1].content, /^Find my garden notes\n\n\[WHAT YOU DID WITH THE TOOLS[^\n]*\n- Looking for seeds: 1 found\n- Adding the dentist \(in Google Calendar\) \[not done: Nate said not now\]: Nate said not now\.\n\nNow answer Nate/)
  assert.equal(answerMessages(QUESTION, []), QUESTION, 'no steps: the question as Ask asked it')
  assert.equal(summaryOf('2 nodes in OSAT:\n- Garden'), '2 topics in OSAT')
  assert.equal(summaryOf('Moved “Buy seeds” to Garden (note-12).'), 'Moved “Buy seeds” to Garden.')
  assert.equal(spoken('## Today\n- **Dentist** at 3, see [the note](osat://x)\n```js\nx\n```'), 'Today Dentist at 3, see the note')
  assert.equal(spoken(Array.from({ length: 150 }, () => 'word').join(' ')).split(' ').length, 120)
})
