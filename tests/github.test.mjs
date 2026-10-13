import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { ago, changeOf, checksOf, checksWords, explainGh, pullOf, summaryOf, validNumber, validRepo } from '../shared/github-model.mjs'

const run = (name, status, conclusion = '') => ({ __typename: 'CheckRun', name, status, conclusion })

test('checks in one word; a skipped job is neither good nor bad', () => {
  const passed = checksOf([run('Tests', 'COMPLETED', 'SUCCESS'), run('iPhone', 'COMPLETED', 'SKIPPED'), run('Mac', 'COMPLETED', 'SUCCESS')])
  assert.equal(passed.state, 'passed')
  assert.equal(checksWords(passed), 'Checks passed')
  const running = checksOf([run('Tests', 'COMPLETED', 'SUCCESS'), run('Mac', 'IN_PROGRESS')])
  assert.equal(checksWords(running), 'Checking… 1 of 2 done')
  const failed = checksOf([run('Tests', 'COMPLETED', 'FAILURE'), run('Mac', 'IN_PROGRESS')])
  assert.equal(failed.state, 'failed', 'a failure wins over what still runs')
  assert.equal(checksWords(failed), '“Tests” failed')
  assert.equal(checksOf([{ __typename: 'StatusContext', context: 'ci', state: 'PENDING' }]).state, 'running')
  assert.equal(checksWords(checksOf([])), 'No checks')
})

test('a pull request says what it does in its own words', () => {
  const body = '## What this does\n\nOSAT now **thinks things over** while you sleep. See `Settings`.\n\nMore.\n\n## How to try it\n\n1. Open it\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'
  assert.equal(summaryOf(body), 'OSAT now thinks things over while you sleep. See Settings.')
  assert.equal(summaryOf('Just a line.\n\n- [ ] a box'), 'Just a line.')
  assert.equal(summaryOf('- Click a line and it glides.\n- Esc goes back.'), 'Click a line and it glides. Esc goes back.')
  assert.equal(summaryOf(''), '')
  assert.ok(summaryOf('word '.repeat(200)).length <= 420)
  const pr = pullOf({ number: 79, title: 'Phase 53', isDraft: true, mergeable: 'CONFLICTING', author: { login: 'SouthernSimp' }, body, statusCheckRollup: [] })
  assert.equal(pr.draft, true)
  assert.equal(pr.conflict, true)
  assert.equal(pr.checks.state, 'none')
})

test('a merge on main says what it merged', () => {
  assert.deepEqual(changeOf({ sha: 'ce4dcbf123', author: { login: 'SouthernSimp' }, commit: { message: 'Merge pull request #78 from SouthernSimp/claude/bar-usable\n\nA quick bar you can use instead of Raycast (Phase 52)', author: { name: 'Nate', date: '2026-10-13T01:30:49Z' } } }), {
    sha: 'ce4dcbf', title: 'A quick bar you can use instead of Raycast (Phase 52) (#78)', author: 'SouthernSimp', at: '2026-10-13T01:30:49Z',
  })
  assert.equal(changeOf({ sha: 'd1bb2ec', author: null, commit: { message: 'Phase 52: a bar\n\nbody', author: { name: 'Nate' } } }).author, 'Nate')
})

test('only real repo names and numbers reach a command', () => {
  assert.equal(validRepo('SouthernSimp/Claude-OSAT-Cloud'), true)
  assert.equal(validRepo('a/b.c_d-e'), true)
  for (const bad of ['', 'nope', 'a/b/c', '--repo=x/y', 'a/..', 'a b/c', 'a/b;rm', null]) assert.equal(validRepo(bad), false, String(bad))
  assert.equal(validNumber(79), true)
  for (const bad of [0, -1, 1.5, '79', NaN]) assert.equal(validNumber(bad), false, String(bad))
})

test('times and failures in plain words', () => {
  const now = Date.parse('2026-10-13T12:00:00Z')
  assert.equal(ago('2026-10-13T11:59:50Z', now), 'just now')
  assert.equal(ago('2026-10-13T11:55:00Z', now), '5 minutes ago')
  assert.equal(ago('2026-10-12T12:00:00Z', now), 'yesterday')
  assert.equal(ago('2026-09-01T12:00:00Z', now), 'Sep 1')
  assert.match(explainGh('To get started with GitHub CLI, please run:  gh auth login'), /sign in/)
  assert.match(explainGh('Pull request is not mergeable: the merge commit cannot be cleanly created.'), /clash with main/)
  assert.equal(explainGh('warning: x\nGraphQL: Something broke'), 'GitHub said: GraphQL: Something broke')
})

/* desktop/github.cjs with a stand-in gh: what it is asked, and what it answers. */
const { createGitHub } = createRequire(import.meta.url)('../desktop/github.cjs')

async function room({ answers = {}, offline = false, installed = true } = {}) {
  const t = { handlers: {}, calls: [], opened: [] }
  await createGitHub({
    sharedModule: (name) => import(`../shared/${name}`),
    handle: (channel, work) => { t.handlers[channel] = work },
    fail: (message) => { throw new Error(message) },
    shell: { openExternal: async (url) => t.opened.push(url) },
    offline: () => offline,
    places: installed ? [process.execPath] : ['/nowhere/gh'],
    run: (file, args, options, done) => {
      t.calls.push(args.join(' '))
      const key = Object.keys(answers).find((start) => args.join(' ').startsWith(start))
      const answer = answers[key]
      if (answer instanceof Error) done(answer, '', answer.message)
      else done(null, typeof answer === 'string' ? answer : JSON.stringify(answer ?? []), '')
    },
  })
  t.ipc = (channel, ...args) => t.handlers[channel](...args)
  return t
}

test('the room: a draft is marked ready before it merges, and only checked names reach gh', async () => {
  const pr = { number: 80, title: 'Trust fixes', isDraft: true, body: '', statusCheckRollup: [run('Tests', 'COMPLETED', 'SUCCESS')] }
  const t = await room({ answers: { 'pr list': [pr], api: [] } })
  const view = await t.ipc('github:repo', 'SouthernSimp/Claude-OSAT-Cloud')
  assert.equal(view.pulls[0].checks.state, 'passed')
  await t.ipc('github:merge', 'SouthernSimp/Claude-OSAT-Cloud', 80)
  assert.deepEqual(t.calls.filter((call) => /^pr (ready|merge)/.test(call)), ['pr ready 80 -R SouthernSimp/Claude-OSAT-Cloud', 'pr merge 80 -R SouthernSimp/Claude-OSAT-Cloud --merge'])
  const before = t.calls.length
  await assert.rejects(t.ipc('github:repo', '--repo=evil/x'), /isn’t a GitHub repository/)
  await assert.rejects(t.ipc('github:merge', 'SouthernSimp/Claude-OSAT-Cloud', '80'), /isn’t a pull request number/)
  await assert.rejects(t.ipc('github:merge', 'SouthernSimp/Claude-OSAT-Cloud', 81), /isn’t open any more/)
  assert.ok(t.calls.slice(before).every((call) => call.startsWith('pr list') || call.startsWith('api ')), 'nothing merged that wasn’t asked for')
  await t.ipc('github:open', 'https://github.com/SouthernSimp/Claude-OSAT-Cloud/pull/80')
  await assert.rejects(t.ipc('github:open', 'https://evil.example/x'), /isn’t a GitHub address/)
  assert.deepEqual(t.opened, ['https://github.com/SouthernSimp/Claude-OSAT-Cloud/pull/80'])
})

test('the room says plainly when gh is missing, signed out or offline', async () => {
  assert.equal((await (await room({ installed: false })).ipc('github:status')).installed, false)
  const out = await room({ answers: { 'api user': new Error('To get started with GitHub CLI, please run:  gh auth login') } })
  assert.match((await out.ipc('github:status')).problem, /sign in/)
  const off = await room({ offline: true })
  await assert.rejects(off.ipc('github:repos'), /back online/)
  assert.deepEqual(off.calls, [])
})
