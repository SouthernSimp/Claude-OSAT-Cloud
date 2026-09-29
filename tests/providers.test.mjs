import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addUsage, chatModels, cleanBaseUrl, cleanBotSettings, cleanKey, cleanProviders, cloudModelId, costLine, explainFailure, parseCloudModelId, presetFor, providerFrom,
} from '../shared/providers.mjs'
import { readSortAnswer, readUnpackAnswer, sortMessages, unpackMessages } from '../shared/ai-tasks.mjs'

const KEY = 'sk-0123456789abcdef0123456789abcdef'

test('keys: pasted with spaces, quotes or "Bearer" still work; cut, mixed-up or odd ones say how to fix it', () => {
  assert.equal(cleanKey(`  "${KEY}"\n`), KEY)
  assert.equal(cleanKey(`Bearer ${KEY}`), KEY)
  assert.equal(cleanKey('xai-AbC.def_ghi~jkl+mno/pqr=stu:vw@x-yz'), 'xai-AbC.def_ghi~jkl+mno/pqr=stu:vw@x-yz')
  assert.throws(() => cleanKey('', 'DeepSeek'), /Paste your DeepSeek API key first/)
  assert.throws(() => cleanKey('sk-0123 4567 89abcdef0123'), /space in it/)
  assert.throws(() => cleanKey('sk-01234567"89abcdef0123', 'DeepSeek'), /doesn’t look like an API key.*DeepSeek/)
  assert.throws(() => cleanKey('sk-012345', 'DeepSeek'), /cut off/)
  assert.throws(() => cleanKey(`sk-${'a'.repeat(500)}`), /longer than an API key/)
})

test('addresses: https, or plain http only on this Mac; no key or extras in it', () => {
  assert.equal(cleanBaseUrl('https://api.deepseek.com/'), 'https://api.deepseek.com')
  assert.equal(cleanBaseUrl(' https://openrouter.ai/api/v1/chat/completions '), 'https://openrouter.ai/api/v1')
  assert.equal(cleanBaseUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1')
  assert.equal(cleanBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1')
  assert.throws(() => cleanBaseUrl('http://api.example.com/v1'), /https:\/\//)
  assert.throws(() => cleanBaseUrl('https://user:secret@api.example.com'), /Leave the key out/)
  assert.throws(() => cleanBaseUrl('api.deepseek.com'), /doesn’t look right/)
  assert.throws(() => cleanBaseUrl('ftp://api.example.com'), /doesn’t look right/)
  assert.throws(() => cleanBaseUrl('https://api.example.com/v1?key=1'), /without anything after/)
})

test('providers: a preset by its id, another by its name and address; kept ones survive a reload', () => {
  assert.deepEqual(providerFrom({ preset: 'deepseek' }), { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' })
  assert.deepEqual(providerFrom({ preset: 'other', name: '  My  Local Llama ', baseUrl: 'http://127.0.0.1:11434/v1/', model: 'llama3.2' }),
    { id: 'custom-my-local-llama', name: 'My Local Llama', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' })
  assert.throws(() => providerFrom({ preset: 'other', baseUrl: 'https://x.dev' }), /Give the provider a name/)
  assert.throws(() => providerFrom({ preset: 'other', name: 'X', baseUrl: 'https://x.dev', model: 'bad model name!' }), /model name/)
  assert.equal(presetFor('xai').baseUrl, 'https://api.x.ai/v1')
  const kept = cleanProviders([
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-reasoner', models: ['deepseek-chat', 'deepseek-reasoner', 42] },
    { id: 'deepseek', name: 'Twice' },
    { id: 'custom-x', name: 'X', baseUrl: 'http://example.com' },
    { id: 'BAD ID', name: 'Y', baseUrl: 'https://y.dev' },
  ])
  assert.deepEqual(kept.map((provider) => [provider.id, provider.model, provider.models]), [['deepseek', 'deepseek-reasoner', ['deepseek-chat', 'deepseek-reasoner']]])
})

test('model ids: "cloud:<provider>:<model>", even with slashes and colons in the model', () => {
  const id = cloudModelId('openrouter', 'meta-llama/llama-3.3:free')
  assert.deepEqual(parseCloudModelId(id), { providerId: 'openrouter', model: 'meta-llama/llama-3.3:free' })
  assert.equal(parseCloudModelId('osat:balanced'), null)
  assert.equal(parseCloudModelId('cloud::x'), null)
})

test('settings: the AI on this Mac unless a connected provider is picked; totals only for providers kept', () => {
  assert.deepEqual(cleanBotSettings(null), { model: 'local', providers: [], usage: {}, connector: { on: false, port: 0 } })
  const settings = cleanBotSettings({
    model: 'cloud:deepseek:deepseek-chat',
    providers: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }],
    usage: { deepseek: { requests: 2, input: 10.4, output: -3, since: '2026-09-29' }, gone: { requests: 9 } },
    connector: { on: true, port: 80 },
    key: KEY,
  })
  assert.equal(settings.model, 'cloud:deepseek:deepseek-chat')
  assert.deepEqual(settings.usage, { deepseek: { requests: 2, input: 10, output: 0, since: '2026-09-29' } })
  assert.deepEqual(settings.connector, { on: true, port: 0 })
  assert.ok(!JSON.stringify(settings).includes(KEY), 'a key never makes it into the settings')
  assert.equal(cleanBotSettings({ ...settings, providers: [] }).model, 'local', 'a removed provider falls back to this Mac')
})

test('failures: one plain line with a way forward', () => {
  const name = 'DeepSeek'
  assert.match(explainFailure({ status: 401, name }), /didn’t accept that key\. Copy it again/)
  assert.match(explainFailure({ status: 402, name }), /out of credit/)
  assert.match(explainFailure({ status: 400, body: '{"error":{"message":"Insufficient Balance"}}', name }), /out of credit/)
  assert.match(explainFailure({ status: 404, name, model: 'deepseek-v9' }), /doesn’t have a model called “deepseek-v9”/)
  assert.match(explainFailure({ status: 429, name }), /too many requests/)
  assert.match(explainFailure({ status: 503, name }), /isn’t answering right now/)
  assert.match(explainFailure({ code: 'OFFLINE', name }), /offline\. DeepSeek waits/)
  assert.match(explainFailure({ code: 'ENOTFOUND', name }), /Nothing answered/)
  assert.match(explainFailure({ name }), /couldn’t reach DeepSeek/)
})

test('usage: a running total per provider, and a rough cost where prices are known', () => {
  let totals = addUsage({}, 'deepseek', { input: 1_000_000, output: 500_000 }, '2026-09-29T10:00:00Z')
  totals = addUsage(totals, 'deepseek', { input: 10, output: 5, estimated: true }, '2026-09-30T10:00:00Z')
  assert.deepEqual(totals.deepseek, { requests: 2, input: 1_000_010, output: 500_005, since: '2026-09-29T10:00:00Z', estimated: true })
  assert.equal(costLine(totals.deepseek, presetFor('deepseek').price), 'about $0.49')
  assert.equal(costLine({ input: 100, output: 100 }, presetFor('deepseek').price), 'under a cent')
  assert.equal(costLine(totals.deepseek, undefined), null, 'no made-up prices')
})

test('chat models: no embeddings, speech or images; the preset’s model first when offered', () => {
  const { list, first } = chatModels(['text-embedding-3-small', 'gpt-4o', 'whisper-1', 'gpt-4o-mini', 'dall-e-3', 'tts-1'], 'gpt-4o-mini')
  assert.deepEqual([list, first], [['gpt-4o', 'gpt-4o-mini'], 'gpt-4o-mini'])
  assert.equal(chatModels(['b', 'a']).first, 'a')
  assert.equal(chatModels([], 'deepseek-chat').first, 'deepseek-chat')
})

test('AI jobs: unpacking reads Markdown answers, even wrapped; nothing usable says so', () => {
  const messages = unpackMessages({ title: 'Spring launch', summary: 'Plan it all.', branches: ['Ideas'] })
  assert.match(messages.at(-1).content, /Spring launch\nPlan it all\./)
  assert.match(messages.at(-1).content, /don't repeat them: Ideas/)
  const tree = readUnpackAnswer('Sure! Here is the plan:\n```markdown\n## Tasks\n- Book the room\n- [x] Pick a date\n## People\n- Ask Jordan\n```', 'Spring launch')
  assert.deepEqual(tree.branches.map((branch) => [branch.title, branch.leaves.map((leaf) => leaf.text)]), [['Tasks', ['Book the room', 'Pick a date']], ['People', ['Ask Jordan']]])
  assert.throws(() => readUnpackAnswer('I cannot help with that.', 'X'), /didn’t suggest any branches/)
})

test('AI jobs: Help me sort reads "sticky: branch" lines, each sticky once, only numbers that exist', () => {
  assert.match(sortMessages({ node: 'Garden', branches: ['Beds', 'Tools'], stickies: ['Buy\nseeds'] }).at(-1).content, /1\. Beds\n2\. Tools[\s\S]*1\. Buy seeds/)
  const picks = readSortAnswer('1: 2\n2 - none\nSticky 3 → Branch 1\n1: 1\n4: 9\n7: 1\nnonsense', 2, 4)
  assert.deepEqual(picks, [{ sticky: 0, branch: 1 }, { sticky: 2, branch: 0 }])
})
