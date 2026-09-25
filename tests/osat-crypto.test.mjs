import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptObject, exportSpaceKey, generateSpaceKey, importSpaceKey, encryptObject } from '../src/osat-crypto.js'

test('encrypted OSAT objects contain no plaintext and fail closed', async () => {
  const key = await generateSpaceKey()
  const restoredKey = await importSpaceKey(await exportSpaceKey(key))
  const value = { title: 'Private household plan', amountMinor: 12345 }
  const envelope = await encryptObject(restoredKey, 'key-device-1', 'space-private', 'note-1', value)

  assert.equal(envelope.algorithm, 'AES-256-GCM')
  assert.equal(JSON.stringify(envelope).includes(value.title), false)
  assert.deepEqual(await decryptObject(key, 'space-private', 'note-1', envelope), value)

  const wrongKey = await generateSpaceKey()
  await assert.rejects(decryptObject(wrongKey, 'space-private', 'note-1', envelope), /DECRYPTION_FAILED/)
  await assert.rejects(decryptObject(key, 'space-private', 'note-2', envelope), /DECRYPTION_FAILED/)

  const tampered = { ...envelope, ciphertext: `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}` }
  await assert.rejects(decryptObject(key, 'space-private', 'note-1', tampered), /DECRYPTION_FAILED/)
})
