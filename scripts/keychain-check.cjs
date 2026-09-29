/* CI on a Mac: a key goes into the real Keychain the way Settings → Bots puts it there
   (on `security -i`'s input), comes back out the same, and Remove takes it away.
     node scripts/keychain-check.cjs */
const { randomBytes } = require('node:crypto')
const { createKeychain } = require('../desktop/bots/keychain.cjs')

async function main() {
  const chain = createKeychain({ service: 'OSAT-CI' })
  if (!chain.lasting) throw new Error('This check needs a Mac.')
  const key = `sk-ci-${randomBytes(16).toString('hex')}`
  await chain.set('cloud-model-ci', key)
  if (await chain.get('cloud-model-ci') !== key) throw new Error('The key did not come back out of the Keychain.')
  await chain.set('cloud-model-ci', `${key}x`)
  if (await chain.get('cloud-model-ci') !== `${key}x`) throw new Error('A new key did not replace the old one.')
  await chain.remove('cloud-model-ci')
  if (await chain.get('cloud-model-ci') !== null) throw new Error('Remove left the key in the Keychain.')
  console.log('Keychain check: a key went in, was replaced, came back out and was removed.')
}

main().catch((error) => {
  console.error(`Keychain check failed: ${error.message}`)
  process.exit(1)
})
