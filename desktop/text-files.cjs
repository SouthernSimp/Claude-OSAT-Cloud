const { createHash, randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')
const { TextDecoder } = require('node:util')

const HASH = /^[0-9a-f]{64}$/
const MAX_READ_BYTES = 2 * 1024 * 1024
const MAX_WRITE_BYTES = 5 * 1024 * 1024
const TEXT_EXTENSIONS = new Set([
  '.c', '.canvas', '.conf', '.cpp', '.css', '.csv', '.go', '.h', '.hpp', '.htm', '.html', '.ini',
  '.java', '.js', '.json', '.jsx', '.log', '.md', '.markdown', '.plist', '.py', '.rb',
  '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.tsv', '.txt', '.xml', '.yaml', '.yml', '.zsh',
])
const TEXT_FILENAMES = new Set(['.gitignore'])
const SECRET_FILENAMES = /^(?:\.env(?:\..*)?|\.netrc|\.npmrc|\.pypirc|client[_-]?secret.*\.json|credentials\.json|secrets?\.json)$/i
const SAFE_OPEN_EXTENSIONS = new Set([
  '.avif', '.canvas', '.conf', '.csv', '.docx', '.gif', '.heic', '.ini', '.jpeg', '.jpg', '.json',
  '.log', '.markdown', '.md', '.pdf', '.png', '.pptx', '.rtf', '.toml', '.tsv', '.txt', '.webp',
  '.xlsx', '.xml', '.yaml', '.yml',
])

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('INVALID_UTF8')
  }
}

function isSafeTextPreviewName(filename) {
  const name = path.basename(filename)
  return !SECRET_FILENAMES.test(name) &&
    (TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) || TEXT_FILENAMES.has(name.toLowerCase()))
}

function isSafeOpenFilename(filename) {
  return SAFE_OPEN_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

async function readTextFile(file, maxBytes = MAX_READ_BYTES) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('NOT_A_FILE')
    if (stat.size > maxBytes) throw new Error('FILE_TOO_LARGE')
    const buffer = Buffer.alloc(stat.size)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (result.bytesRead === 0) throw new Error('FILE_CHANGED_DURING_READ')
      bytesRead += result.bytesRead
    }
    const after = await handle.stat()
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('FILE_CHANGED_DURING_READ')
    return {
      size: bytesRead,
      content: decodeUtf8(buffer),
      hash: sha256(buffer),
      modifiedAt: stat.mtime.toISOString(),
    }
  } finally {
    await handle.close()
  }
}

async function currentFile(file) {
  try {
    const stat = await fs.lstat(file)
    if (stat.isSymbolicLink()) throw new Error('SYMLINK_WRITE_DENIED')
    if (!stat.isFile()) throw new Error('NOT_A_FILE')
    const value = await readTextFile(file, MAX_WRITE_BYTES)
    return { ...value, mode: stat.mode & 0o777 }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function writeTextFile(file, content, expectedHash) {
  if (typeof content !== 'string') throw new Error('INVALID_CONTENT')
  if (expectedHash !== null && (typeof expectedHash !== 'string' || !HASH.test(expectedHash))) {
    throw new Error('INVALID_EXPECTED_HASH')
  }

  const bytes = Buffer.from(content, 'utf8')
  if (bytes.length > MAX_WRITE_BYTES) throw new Error('FILE_TOO_LARGE')

  const before = await currentFile(file)
  if (!before && expectedHash !== null) throw new Error('WRITE_CONFLICT')
  if (before && (expectedHash === null || before.hash !== expectedHash)) throw new Error('WRITE_CONFLICT')

  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const handle = await fs.open(temporary, 'wx', before?.mode || 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }

    if (!before) {
      try {
        await fs.link(temporary, file)
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error('WRITE_CONFLICT')
        throw error
      }
    } else {
      // ponytail: process-local CAS plus a final disk check; add coordinated file
      // locking only if external editors produce a measurable race here.
      if ((await currentFile(file))?.hash !== expectedHash) throw new Error('WRITE_CONFLICT')
      await fs.rename(temporary, file)
      return { size: bytes.length, hash: sha256(bytes) }
    }

    return { size: bytes.length, hash: sha256(bytes) }
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

module.exports = {
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  isSafeOpenFilename,
  isSafeTextPreviewName,
  readTextFile,
  sha256,
  writeTextFile,
}
