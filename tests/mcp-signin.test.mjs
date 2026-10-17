import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { signIn, refreshed } = require('../desktop/bots/mcp-signin.cjs')
const { createAskApps } = require('../desktop/bots/ask-apps.cjs')
const { createKeychain } = require('../desktop/bots/keychain.cjs')

/* A pretend app on 127.0.0.1 that signs in the way Granola's does: protected resource → its sign-in server →
   registration → the browser's page → a code → tokens. `answer` decides where the browser is sent back. */
async function pretendApp({ answer = (query) => ({ code: 'the-code', state: query.get('state') }) } = {}) {
  const seen = { registered: null, authorize: null, tokens: [] }
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, base)
    let body = ''
    for await (const chunk of request) body += chunk
    const json = (value) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    if (url.pathname === '/.well-known/oauth-protected-resource') return json({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['mcp'] })
    if (url.pathname === '/.well-known/oauth-authorization-server') return json({ authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, scopes_supported: ['openid', 'offline_access'] })
    if (url.pathname === '/register') { seen.registered = JSON.parse(body); return json({ client_id: 'osat-1' }) }
    if (url.pathname === '/authorize') {
      seen.authorize = url.searchParams
      const back = new URL(url.searchParams.get('redirect_uri'))
      for (const [name, value] of Object.entries(answer(url.searchParams))) back.searchParams.set(name, value)
      return response.writeHead(302, { location: back.href }).end()
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(body)
      seen.tokens.push(form)
      if (form.get('grant_type') === 'refresh_token') return json({ access_token: 'access-2', expires_in: 3600 })
      const challenge = createHash('sha256').update(form.get('code_verifier') || '').digest('base64url')
      if (form.get('code') !== 'the-code' || challenge !== seen.authorize.get('code_challenge')) return response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_grant"}')
      return json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 })
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return { url: `${base}/mcp`, seen, close: () => server.close() }
}

// The browser: opens the sign-in page and follows it back to OSAT.
const browser = async (url) => { await fetch(url) }

test('signing in: OSAT registers, the browser signs in with PKCE, the code becomes tokens', async () => {
  const app = await pretendApp()
  try {
    const got = await signIn(app.url, { fetch, open: browser })
    assert.equal(got.access, 'access-1')
    assert.equal(got.refresh, 'refresh-1')
    assert.ok(got.expiresAt > Date.now())
    assert.equal(got.clientId, 'osat-1')
    assert.equal(app.seen.registered.client_name, 'OSAT')
    assert.match(app.seen.registered.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    assert.equal(app.seen.authorize.get('code_challenge_method'), 'S256')
    assert.equal(app.seen.authorize.get('scope'), 'mcp offline_access', 'its own scope, and a refresh token')
    assert.equal(app.seen.authorize.get('resource'), app.url)

    const again = await refreshed({ ...got, expiresAt: 0 }, { fetch })
    assert.equal(again.access, 'access-2')
    assert.equal(again.refresh, 'refresh-1', 'the refresh token is kept when no new one comes')
    assert.equal(app.seen.tokens.at(-1).get('refresh_token'), 'refresh-1')
  } finally {
    app.close()
  }
})

test('a sign-in OSAT didn’t start, or one cancelled, says so', async () => {
  const forged = await pretendApp({ answer: () => ({ code: 'the-code', state: 'someone-else' }) })
  await assert.rejects(signIn(forged.url, { fetch, open: browser }), /wasn’t the one OSAT started/)
  assert.equal(forged.seen.tokens.length, 0, 'a forged answer is never traded for tokens')
  forged.close()
  const cancelled = await pretendApp({ answer: (query) => ({ error: 'access_denied', state: query.get('state') }) })
  await assert.rejects(signIn(cancelled.url, { fetch, open: browser }), /The sign-in was cancelled/)
  cancelled.close()
  const slow = await pretendApp()
  await assert.rejects(signIn(slow.url, { fetch, open: async () => {}, wait: 50 }), /took too long/)
  slow.close()
})

test('a signed-in app sends its token, refreshed before it runs out; the token stays in the Keychain', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-signin-'))
  const file = path.join(dir, 'ask-apps.json')
  const headers = []
  let expiresAt = Date.now() + 3600000
  const apps = createAskApps({
    file,
    keychain: createKeychain({ platform: 'memory' }),
    connect: async (server) => { headers.push(server.headers); if (!server.headers.Authorization) throw new Error('It turned OSAT away: sign in, or give it a key.'); return { tools: async () => [{ name: 'list_meetings' }], call: async () => ({ text: 'ok' }), close() {} } },
    signin: {
      signIn: async () => ({ access: 'access-1', refresh: 'refresh-1', expiresAt, clientId: 'c', clientSecret: '', tokenUrl: 'https://x/token', resource: 'https://x/mcp' }),
      refreshed: async (saved) => ({ ...saved, access: 'access-2', expiresAt: Date.now() + 3600000 }),
    },
  })
  await apps.load()
  const added = await apps.add({ kind: 'http', name: 'Granola', url: 'https://mcp.granola.ai/mcp' })
  assert.equal(added.signIn, true)
  assert.match(added.error, /turned OSAT away/)

  const signed = await apps.signIn(added.id)
  assert.equal(signed.error, '')
  assert.equal(signed.signedIn, true)
  assert.equal(signed.tools, 1)
  assert.equal(headers.at(-1).Authorization, 'Bearer access-1')
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /access-1|refresh-1/, 'no token in the file')

  // Next time it starts with its token about to run out: a fresh one first.
  apps.closeAll()
  expiresAt = Date.now() + 1000
  await apps.signIn(added.id)
  apps.closeAll()
  await apps.check(added.id)
  assert.equal(headers.at(-1).Authorization, 'Bearer access-2')
  assert.equal(apps.status().apps[0].signedIn, true)

  const command = await apps.add({ kind: 'command', command: process.execPath, args: ['-e', ''] }).catch(() => null)
  if (command) await assert.rejects(apps.signIn(command.id), /Only an app at a web address/)
})
