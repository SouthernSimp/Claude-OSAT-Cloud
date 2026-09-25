const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_SECRETS = 32
const MAX_VALUE_BYTES = 16 * 1024

class SecretVault {
  constructor(file, safeStorage, platform = process.platform) {
    this.file = file
    this.safeStorage = safeStorage
    this.platform = platform
    this.values = null
    this.mutation = Promise.resolve()
  }

  available() {
    if (!this.safeStorage?.isEncryptionAvailable?.()) return false
    return this.platform !== 'linux' || this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
  }

  status() {
    return { available: this.available(), count: this.values?.size || 0 }
  }

  validateKey(key) {
    if (typeof key !== 'string' || !KEY.test(key)) throw new Error('INVALID_SECRET_KEY')
  }

  async load() {
    if (this.values) return
    let parsed
    try {
      parsed = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.values = new Map()
        return
      }
      throw new Error('SECRET_VAULT_CORRUPT')
    }
    if (parsed?.version !== 1 || !parsed.secrets || Array.isArray(parsed.secrets)) {
      throw new Error('SECRET_VAULT_CORRUPT')
    }
    const entries = Object.entries(parsed.secrets)
    if (entries.length > MAX_SECRETS || entries.some(([key, value]) => !KEY.test(key) || typeof value !== 'string')) {
      throw new Error('SECRET_VAULT_CORRUPT')
    }
    this.values = new Map(entries)
  }

  async save(next) {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      const secrets = Object.fromEntries([...next.entries()].sort(([a], [b]) => a.localeCompare(b)))
      await fs.writeFile(temporary, `${JSON.stringify({ version: 1, secrets }, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await fs.rename(temporary, this.file)
      this.values = next
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  async keys() {
    await this.mutation
    await this.load()
    return [...this.values.keys()].sort()
  }

  async get(key) {
    this.validateKey(key)
    if (!this.available()) throw new Error('SAFE_STORAGE_UNAVAILABLE')
    await this.mutation
    await this.load()
    const encrypted = this.values.get(key)
    if (!encrypted) return null
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      throw new Error('SECRET_DECRYPT_FAILED')
    }
  }

  async set(key, value) {
    this.validateKey(key)
    if (!this.available()) throw new Error('SAFE_STORAGE_UNAVAILABLE')
    if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
      throw new Error('INVALID_SECRET_VALUE')
    }
    return this.mutate(async (next) => {
      if (!next.has(key) && next.size >= MAX_SECRETS) throw new Error('SECRET_LIMIT_REACHED')
      next.set(key, this.safeStorage.encryptString(value).toString('base64'))
      return true
    })
  }

  async delete(key) {
    this.validateKey(key)
    return this.mutate(async (next) => next.delete(key))
  }

  mutate(change) {
    const result = this.mutation.then(async () => {
      await this.load()
      const next = new Map(this.values)
      const value = await change(next)
      await this.save(next)
      return value
    })
    this.mutation = result.catch(() => {})
    return result
  }
}

module.exports = { MAX_SECRETS, MAX_VALUE_BYTES, SecretVault }
