/* Sign in to an app that asks for it (Phase 71b): Granola's and Notion's own servers want OAuth, the way MCP
   describes it. Find where the app signs in (RFC 9728, then RFC 8414), register OSAT there (RFC 7591), open the
   sign-in page in Nate's own browser with PKCE, take the answer on 127.0.0.1, and trade it for tokens. Nothing is
   kept here: ask-apps.cjs puts the tokens in the Keychain. `fetch` is main's, so Offline refuses it; `open` is the
   bots' link opener, refused offline too. */
const http = require('node:http')
const { createHash, randomBytes } = require('node:crypto')

const WAIT = 5 * 60000
const plain = (text) => new Error(text)
const b64url = (bytes) => bytes.toString('base64url')
// https, or this Mac (the tests' pretend app).
const https = (url) => /^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/i.test(String(url || ''))

async function readJson(fetch, url, init) {
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...init?.headers } })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || typeof body !== 'object') throw Object.assign(plain(`It answered with an error (${response.status}).`), { body })
  return body
}

/* Where the app signs in: { resource, scope, meta } (meta: its authorization server's own description). */
async function discover(url, fetch) {
  const server = new URL(url)
  let issuer = server.origin
  let resource = server.href
  let scopes = []
  for (const where of [`${server.origin}/.well-known/oauth-protected-resource${server.pathname.replace(/\/$/, '')}`, `${server.origin}/.well-known/oauth-protected-resource`]) {
    const found = await readJson(fetch, where).catch(() => null)
    if (!https(found?.authorization_servers?.[0])) continue
    issuer = found.authorization_servers[0]
    resource = found.resource || resource
    scopes = Array.isArray(found.scopes_supported) ? found.scopes_supported : []
    break
  }
  const base = new URL(issuer)
  const tail = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '')
  for (const where of [`${base.origin}/.well-known/oauth-authorization-server${tail}`, `${base.origin}/.well-known/openid-configuration${tail}`]) {
    const meta = await readJson(fetch, where).catch(() => null)
    if (!https(meta?.authorization_endpoint) || !https(meta?.token_endpoint)) continue
    // A refresh token, where the app gives one only when asked, so a sign-in lasts.
    const lasting = Array.isArray(meta.scopes_supported) && meta.scopes_supported.includes('offline_access') ? ['offline_access'] : []
    return { resource, scope: [...new Set([...scopes, ...lasting])].join(' '), meta }
  }
  throw plain('That app doesn’t offer a sign-in OSAT knows. Give it a key instead.')
}

/* The page the browser comes back to, on this Mac only, for one answer. */
function loopback() {
  return new Promise((resolve, reject) => {
    let answered
    const answer = new Promise((done) => { answered = done })
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (url.pathname !== '/callback') return response.writeHead(404).end()
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><meta charset="utf-8"><title>OSAT</title><body style="font:16px -apple-system,sans-serif;margin:4em;text-align:center">You can close this tab and go back to OSAT.</body>')
      answered(url.searchParams)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ redirect: `http://127.0.0.1:${server.address().port}/callback`, answer, close: () => server.close() }))
  })
}

async function token(fetch, url, client, fields) {
  const body = new URLSearchParams({ ...fields, client_id: client.id })
  if (client.secret) body.set('client_secret', client.secret)
  const got = await readJson(fetch, url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    .catch((error) => { throw plain(error.body?.error === 'invalid_grant' ? 'The sign-in ran out. Sign in again.' : 'The app didn’t finish the sign-in. Try again.') })
  if (typeof got.access_token !== 'string' || !got.access_token) throw plain('The app didn’t finish the sign-in. Try again.')
  return { access: got.access_token, refresh: typeof got.refresh_token === 'string' ? got.refresh_token : '', expiresAt: Number(got.expires_in) > 0 ? Date.now() + Number(got.expires_in) * 1000 : 0 }
}

/* The whole sign-in, from the app's address to its tokens: { access, refresh, expiresAt, clientId, clientSecret, tokenUrl, resource }. */
async function signIn(url, { fetch, open, listen = loopback, wait = WAIT }) {
  const { resource, scope, meta } = await discover(url, fetch)
  const back = await listen()
  let timer
  try {
    if (!https(meta.registration_endpoint)) throw plain('That app wants OSAT registered by hand first. Give it a key instead.')
    const made = await readJson(fetch, meta.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'OSAT', redirect_uris: [back.redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
    }).catch(() => { throw plain('The app wouldn’t let OSAT sign in. Try again later, or give it a key.') })
    const client = { id: String(made.client_id || ''), secret: typeof made.client_secret === 'string' ? made.client_secret : '' }
    if (!client.id) throw plain('The app wouldn’t let OSAT sign in. Try again later, or give it a key.')

    const verifier = b64url(randomBytes(32))
    const state = b64url(randomBytes(16))
    const page = new URL(meta.authorization_endpoint)
    for (const [name, value] of Object.entries({ response_type: 'code', client_id: client.id, redirect_uri: back.redirect, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state, resource, ...(scope ? { scope } : {}) })) page.searchParams.set(name, value)
    await open(page.href)

    const answer = await Promise.race([back.answer, new Promise((_, reject) => { timer = setTimeout(() => reject(plain('The sign-in took too long. Try again.')), wait) })])
    if (answer.get('state') !== state) throw plain('That sign-in wasn’t the one OSAT started. Try again.')
    if (answer.get('error')) throw plain(answer.get('error') === 'access_denied' ? 'The sign-in was cancelled.' : `The sign-in didn’t finish (${String(answer.get('error')).slice(0, 60)}).`)
    if (!answer.get('code')) throw plain('The app didn’t finish the sign-in. Try again.')
    const tokens = await token(fetch, meta.token_endpoint, client, { grant_type: 'authorization_code', code: answer.get('code'), redirect_uri: back.redirect, code_verifier: verifier, resource })
    return { ...tokens, clientId: client.id, clientSecret: client.secret, tokenUrl: meta.token_endpoint, resource }
  } finally {
    clearTimeout(timer)
    back.close()
  }
}

/* New tokens from the refresh token, before the old ones run out. */
async function refreshed(saved, { fetch }) {
  if (!saved.refresh) throw plain('The sign-in ran out. Sign in again.')
  const tokens = await token(fetch, saved.tokenUrl, { id: saved.clientId, secret: saved.clientSecret }, { grant_type: 'refresh_token', refresh_token: saved.refresh, resource: saved.resource })
  return { ...saved, ...tokens, refresh: tokens.refresh || saved.refresh }
}

module.exports = { signIn, refreshed, discover, loopback }
