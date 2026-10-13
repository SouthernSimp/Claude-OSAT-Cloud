/* The GitHub room (Phase 55, Tools → GitHub): Nate's repos and pull requests in plain words, with
   Merge (asked twice in the room) and Open on GitHub. It talks to GitHub only through the `gh` tool
   already signed in on this Mac (Homebrew's), never a key of OSAT's own; no shell, and only checked
   repo names and numbers go into its arguments. Every github:* channel waits while Offline
   (under.cjs), and the one command line checks Offline itself too (tests/under.test.mjs).
     github:status → { installed, user } · github:repos · github:repo (name) → { pulls, changes }
     github:merge (name, number) → the repo again · github:open (a github.com address)
   The words are shared/github-model.mjs. */
const fs = require('node:fs')
const { execFile } = require('node:child_process')

// Finder-opened apps don't get Homebrew's PATH, so look where Homebrew puts it.
const PLACES = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']
const NOT_INSTALLED = 'OSAT uses GitHub’s own gh tool. Install it with Homebrew (brew install gh), then run gh auth login in Terminal.'

async function createGitHub({ sharedModule, handle, fail, shell, offline = () => false, places = PLACES, run = execFile }) {
  const model = await sharedModule('github-model.mjs')
  const where = () => places.find((file) => { try { fs.accessSync(file, fs.constants.X_OK); return true } catch { return false } }) || null

  function gh(args) {
    const file = where()
    if (!file) return Promise.reject(new Error(NOT_INSTALLED))
    return new Promise((resolve, reject) => {
      if (offline()) return reject(new Error('GitHub waits until you’re back online.'))
      run(file, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' } }, (error, stdout, stderr) => {
        if (error) reject(new Error(model.explainGh(stderr || error.message)))
        else resolve(String(stdout))
      })
    })
  }
  const json = async (args) => JSON.parse(await gh(args))
  const checked = (repo) => { if (!model.validRepo(repo)) fail('That isn’t a GitHub repository name.'); return repo }

  async function repo(name) {
    const [pulls, changes] = await Promise.all([
      json(['pr', 'list', '-R', name, '--state', 'open', '--limit', '30', '--json', 'number,title,body,headRefName,isDraft,updatedAt,url,author,statusCheckRollup,mergeable']),
      json(['api', `repos/${name}/commits?per_page=10`]).catch(() => []),
    ])
    return {
      name,
      pulls: pulls.map(model.pullOf).sort((a, b) => b.number - a.number),
      changes: Array.isArray(changes) ? changes.map(model.changeOf) : [],
    }
  }

  handle('github:status', async () => {
    if (!where()) return { installed: false, user: null, problem: NOT_INSTALLED }
    try {
      return { installed: true, user: (await gh(['api', 'user', '--jq', '.login'])).trim() || null }
    } catch (error) {
      return { installed: true, user: null, problem: error.message }
    }
  }, { from: 'app' })
  handle('github:repos', async () => {
    const list = await json(['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,description,isPrivate,updatedAt,url'])
    return list.map(model.repoOf).filter((item) => model.validRepo(item.name)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }, { from: 'app' })
  handle('github:repo', async (name) => repo(checked(name)), { from: 'app' })
  // A draft is marked ready first (GitHub won't merge a draft); then a merge commit, as Claude has always merged.
  handle('github:merge', async (name, number) => {
    checked(name)
    if (!model.validNumber(number)) fail('That isn’t a pull request number.')
    const [pr] = (await repo(name)).pulls.filter((item) => item.number === number)
    if (!pr) fail('That pull request isn’t open any more.')
    if (pr.draft) await gh(['pr', 'ready', String(number), '-R', name])
    await gh(['pr', 'merge', String(number), '-R', name, '--merge'])
    return repo(name)
  }, { from: 'app' })
  handle('github:open', async (url) => {
    if (typeof url !== 'string' || !/^https:\/\/github\.com\/[\w./#?=&%-]*$/.test(url)) fail('That isn’t a GitHub address.')
    if (!offline()) await shell.openExternal(url)
    return true
  }, { from: 'app' })
}

module.exports = { createGitHub, NOT_INSTALLED }
