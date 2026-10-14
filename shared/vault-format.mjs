/* Passwords (Phase 58): the sealed file. node:crypto only, no dependencies, nothing exotic.

     master password --scrypt(N, r, p, 16-byte random salt)--> 32-byte key --AES-256-GCM--> the whole vault as JSON

   * The parameters (N, r, p, key length, salt) live in the file's header, so they can be raised later; a file whose N is
     lower than today's floor, or absurdly high, is refused before any work is done (a changed header is also an unequal key).
   * A fresh random 12-byte nonce on EVERY seal. The header (format, version, kdf, cipher, nonce) is the GCM
     "additional data": changing any byte of it, of the ciphertext or of the tag fails the tag.
   * A wrong master password and a tampered file fail the same tag and say the same thing (`cannot-open`).
   * Nothing secret is compared with == (`sameSecret` hashes both sides, then timingSafeEqual).
   * The plaintext is padded to a multiple of 4 KiB, so the file's size doesn't say how many passwords there are.
   * The key is a Buffer: `wipe()` overwrites it (the decrypted entries are only held in main, and are dropped there).
   Main alone imports this file (desktop/passwords.cjs); tests/vault-fence.test.mjs keeps it that way. */
import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)

export const FORMAT = 'osat-passwords'
export const VERSION = 1
export const CIPHER = 'aes-256-gcm'
// Today's cost: 128 MiB and about half a second on a Mac. Raising it later is a change of this one line.
export const DEFAULT_KDF = Object.freeze({ name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLength: 32 })
export const MIN_N = 2 ** 17
export const MAX_N = 2 ** 19
const PAD = 4096

/* Everything that goes wrong opening a file is one of these. `calm` marks the message as safe to show. */
export class VaultError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'VaultError'
    this.code = code
    this.calm = true
  }
}
const CANNOT_OPEN = () => new VaultError('cannot-open', 'That didn’t unlock your passwords. Check the master password and try again.')
const NOT_VAULT = () => new VaultError('not-vault', 'That isn’t a passwords file OSAT can read.')
const TOO_NEW = () => new VaultError('too-new', 'That passwords file was made by a newer OSAT. Update OSAT to open it.')

const b64 = (buffer) => Buffer.from(buffer).toString('base64')
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
function unb64(value, bytes) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !BASE64.test(value)) return null
  const buffer = Buffer.from(value, 'base64')
  return bytes === undefined || buffer.length === bytes ? buffer : null
}

/* Two secrets are the same? Not with ==. */
export function sameSecret(a, b) {
  const hash = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest()
  return crypto.timingSafeEqual(hash(a), hash(b))
}

export const newSalt = () => b64(crypto.randomBytes(16))
export const newKdf = (params = DEFAULT_KDF) => ({ ...params, salt: newSalt() })

function kdfOk(kdf) {
  return Boolean(kdf) && kdf.name === 'scrypt'
    && Number.isInteger(kdf.N) && kdf.N >= MIN_N && kdf.N <= MAX_N && (kdf.N & (kdf.N - 1)) === 0
    && Number.isInteger(kdf.r) && kdf.r >= 8 && kdf.r <= 16
    && Number.isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= 4
    && kdf.keyLength === 32
    && unb64(kdf.salt, 16) !== null
}

/* The same password on any keyboard: Unicode's compatibility form. */
export async function deriveKey(password, kdf) {
  const secret = Buffer.from(String(password ?? '').normalize('NFKC'), 'utf8')
  try {
    // scrypt needs 128 * N * r bytes; Node's default ceiling is 32 MiB, so say what is needed (plus a little).
    return await scrypt(secret, Buffer.from(kdf.salt, 'base64'), kdf.keyLength, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r + 128 * kdf.r * kdf.p + (1 << 20) })
  } finally {
    secret.fill(0)
  }
}

/* The header, in a fixed order, as the GCM "additional data". */
const aadOf = (version, kdf, cipher, nonce) => Buffer.from(JSON.stringify([FORMAT, version, kdf.name, kdf.N, kdf.r, kdf.p, kdf.keyLength, kdf.salt, cipher, nonce]), 'utf8')

/* Text -> the parts of a file, or a VaultError. Untrusted: every field is checked before it is used. */
export function parse(text) {
  let file
  try { file = JSON.parse(text) } catch { throw NOT_VAULT() }
  if (!file || typeof file !== 'object' || file.format !== FORMAT) throw NOT_VAULT()
  if (!Number.isInteger(file.version) || file.version < 1) throw NOT_VAULT()
  if (file.version > VERSION) throw TOO_NEW()
  // From here on a bad field is what a damaged or tampered file looks like: the same calm answer as a wrong password.
  const { kdf } = file
  const nonce = unb64(file.nonce, 12)
  const tag = unb64(file.tag, 16)
  const data = unb64(file.ciphertext)
  if (file.cipher !== CIPHER || !kdfOk(kdf) || !nonce || !tag || !data) throw CANNOT_OPEN()
  const tries = file.attempts
  const attempts = tries && Number.isInteger(tries.failed) && tries.failed > 0 && Number.isFinite(tries.lastAt) ? { failed: tries.failed, lastAt: tries.lastAt } : null
  return { version: file.version, kdf: { name: kdf.name, N: kdf.N, r: kdf.r, p: kdf.p, keyLength: kdf.keyLength, salt: kdf.salt }, cipher: file.cipher, nonceText: file.nonce, nonce, tag, data, attempts }
}

/* Encrypt the vault with a key already derived: a new nonce every time. Returns the file's text. `attempts` (how many
   wrong guesses, and when) sits beside the sealed part and is not part of it: counting a wrong guess needs no key. */
export function seal(key, kdf, data, { attempts = null } = {}) {
  // An all-zero key is a wiped one (a lock): sealing with it would write a file nothing can open.
  if (!Buffer.isBuffer(key) || key.length !== 32 || key.every((byte) => byte === 0)) throw new VaultError('locked', 'Your passwords are locked.')
  const json = Buffer.from(JSON.stringify(data), 'utf8')
  const plain = Buffer.alloc(Math.ceil((json.length + 1) / PAD) * PAD, 0x20) // spaces: JSON ignores them
  json.copy(plain)
  const nonceBytes = crypto.randomBytes(12)
  const nonce = b64(nonceBytes)
  const cipher = crypto.createCipheriv(CIPHER, key, nonceBytes, { authTagLength: 16 })
  cipher.setAAD(aadOf(VERSION, kdf, CIPHER, nonce))
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  plain.fill(0)
  json.fill(0)
  const file = { format: FORMAT, version: VERSION, kdf: { name: kdf.name, N: kdf.N, r: kdf.r, p: kdf.p, keyLength: kdf.keyLength, salt: kdf.salt }, cipher: CIPHER, nonce, tag: b64(tag), ciphertext: b64(ciphertext) }
  if (attempts) file.attempts = attempts
  return `${JSON.stringify(file)}\n`
}

function decrypt(parts, key) {
  let plain
  try {
    const decipher = crypto.createDecipheriv(CIPHER, key, parts.nonce, { authTagLength: 16 })
    decipher.setAAD(aadOf(parts.version, parts.kdf, parts.cipher, parts.nonceText))
    decipher.setAuthTag(parts.tag)
    plain = Buffer.concat([decipher.update(parts.data), decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  } catch {
    throw CANNOT_OPEN()
  } finally {
    plain?.fill(0)
  }
}

/* A new file for a new master password. */
export async function create(password, data, { kdf = newKdf() } = {}) {
  if (!kdfOk(kdf)) throw new VaultError('bad-kdf', 'Passwords can’t be set up with those settings.')
  const key = await deriveKey(password, kdf)
  return { session: { key, kdf, data }, text: seal(key, kdf, data) }
}

/* Open a file with the master password. A wrong password and a tampered file are the same failure. */
export async function open(text, password) {
  const parts = parse(text)
  const key = await deriveKey(password, parts.kdf)
  try {
    return { key, kdf: parts.kdf, data: decrypt(parts, key) }
  } catch (error) {
    key.fill(0)
    throw error
  }
}

/* Is this the key that opens this file? (Used to check the current master password before changing it.) */
export function opensWith(text, key) {
  try { decrypt(parse(text), key); return true } catch { return false }
}

/* The file with its guess-count changed (or removed, with null), the sealed part untouched. */
export function withAttempts(text, attempts) {
  const file = JSON.parse(text)
  if (attempts) file.attempts = attempts
  else delete file.attempts
  return `${JSON.stringify(file)}\n`
}

/* What the key is a Buffer for: a lock overwrites it. The entries are dropped from the session as well. */
export function wipe(session) {
  if (!session) return
  if (Buffer.isBuffer(session.key)) session.key.fill(0)
  if (session.data && Array.isArray(session.data.entries)) for (const entry of session.data.entries) entry.password = ''
  session.data = null
}
