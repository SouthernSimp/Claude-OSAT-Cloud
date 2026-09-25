const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

function relativeParts(relative = '') {
  if (
    typeof relative !== 'string' || relative.length > 4096 ||
    relative.includes('\0') || relative.includes('\\')
  ) {
    throw new Error('INVALID_RELATIVE_PATH')
  }
  if (!relative) return []
  const parts = relative.split('/')
  if (parts.length > 256 || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('INVALID_RELATIVE_PATH')
  }
  return parts
}

function contains(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function resolveApprovedPath(root, relative = '') {
  const approvedRoot = path.resolve(root)
  const canonicalRoot = await fs.realpath(approvedRoot)
  if (canonicalRoot !== approvedRoot) throw new Error('ROOT_CHANGED')

  const candidate = path.join(approvedRoot, ...relativeParts(relative))
  const canonicalCandidate = await fs.realpath(candidate)
  if (!contains(approvedRoot, canonicalCandidate)) throw new Error('PATH_OUTSIDE_ROOT')
  return canonicalCandidate
}

async function resolveApprovedWritePath(root, relative) {
  const approvedRoot = path.resolve(root)
  const canonicalRoot = await fs.realpath(approvedRoot)
  if (canonicalRoot !== approvedRoot) throw new Error('ROOT_CHANGED')

  const parts = relativeParts(relative)
  if (!parts.length) throw new Error('INVALID_RELATIVE_PATH')
  const requested = path.join(approvedRoot, ...parts)
  const canonicalParent = await fs.realpath(path.dirname(requested))
  if (!contains(approvedRoot, canonicalParent)) throw new Error('PATH_OUTSIDE_ROOT')

  const candidate = path.join(canonicalParent, path.basename(requested))
  if (!contains(approvedRoot, candidate)) throw new Error('PATH_OUTSIDE_ROOT')
  try {
    if ((await fs.lstat(candidate)).isSymbolicLink()) throw new Error('PATH_OUTSIDE_ROOT')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return candidate
}

async function selfCheck() {
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'osat-path-guard-')))
  const root = path.join(fixture, 'root')
  const outside = path.join(fixture, 'outside')

  try {
    await fs.mkdir(root)
    await fs.mkdir(outside)
    await fs.writeFile(path.join(root, 'note.md'), 'safe')
    await fs.writeFile(path.join(outside, 'secret.md'), 'private')
    await fs.symlink(outside, path.join(root, 'escape'))

    assert.equal(await resolveApprovedPath(root, 'note.md'), path.join(root, 'note.md'))
    assert.equal(await resolveApprovedWritePath(root, 'new.md'), path.join(root, 'new.md'))
    await assert.rejects(resolveApprovedPath(root, '../outside/secret.md'), /INVALID_RELATIVE_PATH/)
    await assert.rejects(resolveApprovedPath(root, 'escape/secret.md'), /PATH_OUTSIDE_ROOT/)
    await assert.rejects(resolveApprovedWritePath(root, 'escape/new.md'), /PATH_OUTSIDE_ROOT/)
  } finally {
    await fs.rm(fixture, { recursive: true, force: true })
  }
}

module.exports = { relativeParts, resolveApprovedPath, resolveApprovedWritePath }

if (require.main === module) {
  selfCheck()
    .then(() => console.log('path guard self-check passed'))
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
