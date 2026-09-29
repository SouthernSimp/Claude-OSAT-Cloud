/* API keys live in the macOS Keychain, never in a file, a log or the repo. Through Apple's
   own `security` tool: reading prints the key to OSAT alone, and writing hands it over on
   `security -i`'s input, so it never appears on a command line other apps could see.
   Off the Mac (the Linux tests and CI) there is no Keychain: keys are held in memory until
   OSAT quits, and `lasting` says so. `run` and `spawn` are passed in for the tests. */
const { execFile, spawn: nodeSpawn } = require('node:child_process')

const ACCOUNT = /^[a-z0-9-]{1,64}$/
// Keys are checked by cleanKey first; this keeps anything that could break the command out.
const SAFE_SECRET = /^[A-Za-z0-9._~+/=:@-]{1,400}$/

function runFile(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10000, maxBuffer: 64 * 1024 }, (error, stdout) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout) }))
  })
}

function feed(spawn, file, args, input) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    } catch {
      resolve(1)
      return
    }
    const timer = setTimeout(() => child.kill(), 10000)
    child.on('error', () => { clearTimeout(timer); resolve(1) })
    child.on('close', (code) => { clearTimeout(timer); resolve(code ?? 1) })
    child.stdin.end(input)
  })
}

function createKeychain({ service = 'OSAT', platform = process.platform, run = runFile, spawn = nodeSpawn } = {}) {
  if (platform !== 'darwin') {
    const held = new Map()
    return {
      lasting: false,
      get: async (account) => held.get(account) ?? null,
      set: async (account, secret) => { held.set(account, secret) },
      remove: async (account) => { held.delete(account) },
    }
  }
  const check = (account) => {
    if (!ACCOUNT.test(account)) throw new Error('That isn’t a provider OSAT knows.')
  }
  const chain = {
    lasting: true,
    async get(account) {
      check(account)
      const { code, stdout } = await run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'])
      return code === 0 ? stdout.replace(/\n$/, '') || null : null
    },
    async set(account, secret) {
      check(account)
      if (!SAFE_SECRET.test(secret)) throw new Error('That doesn’t look like an API key.')
      await feed(spawn, '/usr/bin/security', ['-i'], `add-generic-password -U -s ${service} -a ${account} -l ${service}-${account} -w ${secret}\n`)
      // `security -i` ends well whatever happened inside it: reading the key back is the proof.
      if (await chain.get(account) !== secret) throw new Error('The Keychain didn’t take the key. Unlock your Mac’s Keychain (Keychain Access), then try again.')
    },
    async remove(account) {
      check(account)
      await run('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account])
    },
  }
  return chain
}

module.exports = { createKeychain }
