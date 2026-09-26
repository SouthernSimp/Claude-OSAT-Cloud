/* Fetches one model file. It lands in `<file>.part` first, so a download stopped
   halfway (quit, sleep, lost Wi-Fi) picks up where it left off. The finished file
   must have the exact size and SHA-256 from the catalog, or it is thrown away. */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')

// Room to spare after the download, so the Mac is never filled to the brim.
const MARGIN = 2 * 1024 ** 3

class DownloadError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

async function freeBytes(dir) {
  const stats = await fsp.statfs(dir)
  return stats.bavail * stats.bsize
}

async function hashInto(hash, file) {
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
}

async function downloadFile({ url, dest, size, sha256, onProgress = () => {}, signal, fetchImpl = fetch, free = freeBytes }) {
  const part = `${dest}.part`
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  let have = await fsp.stat(part).then((stat) => stat.size, () => 0)
  if (have > size) {
    await fsp.rm(part, { force: true })
    have = 0
  }
  const needed = size - have + MARGIN
  if ((await free(path.dirname(dest))) < needed) {
    throw new DownloadError('NO_SPACE', `This needs about ${Math.ceil(needed / 1e9)} GB free on your Mac.`)
  }

  let hash = createHash('sha256')
  if (have) await hashInto(hash, part)
  onProgress(have, size)

  if (have < size) {
    const response = await fetchImpl(url, { headers: have ? { range: `bytes=${have}-` } : {}, signal })
    if (have && response.status === 200) {
      // The server ignored the range: start from the beginning.
      hash = createHash('sha256')
      have = 0
    } else if (!response.ok || !response.body) {
      throw new DownloadError('HTTP', `The download server answered ${response.status}.`)
    }
    const count = new Transform({
      transform(chunk, _encoding, done) {
        hash.update(chunk)
        have += chunk.length
        onProgress(have, size)
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), count, fs.createWriteStream(part, { flags: have ? 'a' : 'w' }), { signal })
  }

  if (have !== size || hash.digest('hex') !== sha256) {
    await fsp.rm(part, { force: true })
    throw new DownloadError('CHECKSUM', 'The download arrived damaged, so it was thrown away.')
  }
  await fsp.rename(part, dest)
}

module.exports = { DownloadError, MARGIN, downloadFile }
