const ALGORITHM = 'AES-256-GCM'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function subtle() {
  if (!globalThis.crypto?.subtle) throw new Error('WEB_CRYPTO_UNAVAILABLE')
  return globalThis.crypto.subtle
}

function toBase64Url(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_CIPHERTEXT_ENCODING')
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function context(spaceId, objectId) {
  if (!spaceId || !objectId) throw new Error('ENCRYPTION_CONTEXT_REQUIRED')
  return encoder.encode(`osat:v1:${spaceId}:${objectId}`)
}

export async function generateSpaceKey() {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function exportSpaceKey(key) {
  return toBase64Url(new Uint8Array(await subtle().exportKey('raw', key)))
}

export async function importSpaceKey(encoded) {
  const raw = fromBase64Url(encoded)
  if (raw.byteLength !== 32) throw new Error('INVALID_SPACE_KEY')
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

export async function encryptObject(key, keyId, spaceId, objectId, value) {
  if (!keyId) throw new Error('KEY_ID_REQUIRED')
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(value))
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: context(spaceId, objectId) }, key, plaintext)
  return {
    algorithm: ALGORITHM,
    key_id: keyId,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptObject(key, spaceId, objectId, envelope) {
  if (envelope?.algorithm !== ALGORITHM) throw new Error('UNSUPPORTED_ENCRYPTION_ALGORITHM')
  const nonce = fromBase64Url(envelope.nonce)
  if (nonce.byteLength !== 12) throw new Error('INVALID_NONCE')
  try {
    const plaintext = await subtle().decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: context(spaceId, objectId) },
      key,
      fromBase64Url(envelope.ciphertext),
    )
    return JSON.parse(decoder.decode(plaintext))
  } catch {
    throw new Error('DECRYPTION_FAILED')
  }
}
