/* Your Mac's own files, as OSAT shows them: the three folders it can look in
   (macOS asks once before an app opens each), what Finder counts as one file,
   what Ask can read from a file, and Spotlight search. Commands are passed in
   so the pure pieces can be tested. */
const { execFile } = require('node:child_process')
const path = require('node:path')
const { isSafeTextPreviewName, readTextFile } = require('./text-files.cjs')

const PLACES = [
  { id: 'desktop', name: 'Desktop' },
  { id: 'documents', name: 'Documents' },
  { id: 'downloads', name: 'Downloads' },
]

/* Folders Finder shows as a single file. */
const PACKAGES = new Set([
  '.app', '.band', '.bundle', '.fcpbundle', '.framework', '.imovielibrary', '.key', '.logicx', '.mpkg', '.musiclibrary',
  '.numbers', '.pages', '.photoslibrary', '.pkg', '.playground', '.rtfd', '.scptd', '.sparsebundle', '.xcodeproj', '.xcworkspace',
])
const isPackage = (name) => PACKAGES.has(path.extname(name).toLowerCase())

function run(command, args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))))
  })
}

/* What Ask reads from one file: plain text as it is, PDFs through the Mac's own
   PDFKit, Word and rich text through textutil. Enough to answer about, not the whole book.
   A scan (a PDF with no words in it, or a picture) is read by the Mac's own text
   recognition (Vision, the engine behind Live Text; it reads handwriting too), up to
   10 pages. A wide gap between lines becomes a blank line. */
const MAX_CHARS = 12000
const RICH = new Set(['.doc', '.docx', '.htm', '.html', '.odt', '.rtf', '.rtfd', '.webarchive'])
const PICTURES = new Set(['.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff'])
// ponytail: a picture with a see-through background reads as nothing; scanners never make one.
const PDF_TEXT = `ObjC.import("PDFKit"); ObjC.import("Vision"); ObjC.import("AppKit")
function lines(data) {
  const req = $.VNRecognizeTextRequest.alloc.init
  req.usesLanguageCorrection = true
  $.VNImageRequestHandler.alloc.initWithDataOptions(data, $({})).performRequestsError($([req]), null)
  const out = []
  let last = null
  for (let i = 0; i < req.results.count; i++) {
    const found = req.results.objectAtIndex(i)
    const box = found.boundingBox
    if (last && last.origin.y - (box.origin.y + box.size.height) > box.size.height * 1.5) out.push("")
    out.push(found.topCandidates(1).objectAtIndex(0).string.js)
    last = box
  }
  return out.join("\\n")
}
function run(argv) {
  if (!/\\.pdf$/i.test(argv[0])) return lines($.NSData.dataWithContentsOfFile(argv[0]))
  const d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]))
  if (d.isNil()) return ""
  const text = d.string.isNil() ? "" : d.string.js.slice(0, 20000)
  if (text.trim().length > 20) return text
  const pages = []
  for (let i = 0; i < Math.min(d.pageCount, 10); i++) {
    const page = d.pageAtIndex(i)
    const size = page.boundsForBox(0).size
    const scale = 2000 / Math.max(size.width, size.height)
    pages.push(lines(page.thumbnailOfSizeForBox({ width: size.width * scale, height: size.height * scale }, 0).TIFFRepresentation))
  }
  return pages.join("\\n\\n")
}`

async function extractText(file, { exec = run, readText = readTextFile } = {}) {
  const ext = path.extname(file).toLowerCase()
  let text
  if (ext === '.pdf' || PICTURES.has(ext)) text = await exec('osascript', ['-l', 'JavaScript', '-e', PDF_TEXT, file], { timeout: 90000 })
  else if (RICH.has(ext)) text = await exec('textutil', ['-convert', 'txt', '-stdout', file])
  else if (isSafeTextPreviewName(file)) text = (await readText(file)).content
  else throw new Error('UNREADABLE')
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw new Error('EMPTY')
  return { text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS }
}

/* Spotlight, only inside the folders OSAT may show. `query` is a Spotlight query
   (shared/file-query.mjs: the words in the name or inside, a kind, a time). */
function searchArgs(query, roots) {
  return [...roots.flatMap((root) => ['-onlyin', root]), query]
}

/* The paths that lie in one of the roots, as { rootId, relative, name, depth }: never hidden,
   never inside a package. A path under two roots belongs to the deeper one. */
function inside(paths, roots) {
  const byDepth = [...roots].sort((a, b) => b.root.length - a.root.length)
  const found = []
  for (const file of paths) {
    const root = byDepth.find((item) => file.startsWith(`${item.root}${path.sep}`))
    if (!root) continue
    const parts = file.slice(root.root.length + 1).split(path.sep)
    if (parts.some((part) => !part || part.startsWith('.')) || parts.slice(0, -1).some(isPackage)) continue
    found.push({ rootId: root.id, relative: parts.join('/'), name: parts.at(-1), depth: parts.length })
  }
  return found
}

/* Best first: names that start with the words, then names holding every word (the rest had
   them inside), then the newest when asked (a search for a kind or a time), then the
   shallowest. */
function rankFound(items, words, { newest = false } = {}) {
  const lower = words.map((word) => word.toLowerCase()).filter(Boolean)
  const tier = (item) => {
    const name = item.name.toLowerCase()
    if (lower.length && name.startsWith(lower.join(' '))) return 2
    return lower.every((word) => name.includes(word)) ? 1 : 0
  }
  const age = (a, b) => (newest ? String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')) : 0)
  return [...items].sort((a, b) => tier(b) - tier(a) || age(a, b) || a.depth - b.depth || a.name.localeCompare(b.name))
}

/* Spotlight's matches as { rootId, relative, name }, best first. */
function locate(paths, roots, query, limit = 12) {
  return rankFound(inside(paths, roots), query.trim().split(/\s+/))
    .slice(0, limit)
    .map(({ depth, ...item }) => item)
}

/* Where there is no Spotlight (the tests, and OSAT from source on Linux): walk the folders a
   few levels deep, skipping hidden things, links and package insides. `test({ name, folder,
   modifiedAt, inside })` decides; small text files are read for `inside`. */
async function walkFind(roots, test, { fs = require('node:fs/promises'), depth = 6, max = 5000 } = {}) {
  const found = []
  let seen = 0
  for (const root of roots) {
    const queue = [[root.root, 0]]
    while (queue.length && seen < max) {
      const [dir, level] = queue.shift()
      for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink() || seen++ >= max) continue
        const file = path.join(dir, entry.name)
        const stat = await fs.lstat(file).catch(() => null)
        if (!stat) continue
        const folder = stat.isDirectory() && !isPackage(entry.name)
        const text = stat.isFile() && stat.size <= 256 * 1024 && isSafeTextPreviewName(entry.name)
          ? await fs.readFile(file, 'utf8').catch(() => '')
          : ''
        if (test({ name: entry.name, folder, modifiedAt: stat.mtime.toISOString(), inside: text })) found.push(file)
        if (folder && level + 1 < depth) queue.push([file, level + 1])
      }
    }
  }
  return found
}

/* The Mac's Bin, through the Mac itself. It says where the file landed, so Undo can fetch it
   (JXA reads that back only through `$()`; a `Ref()` crashes osascript). Reading the Bin can be
   refused to an app without Full Disk Access, so putting a file back may ask Finder to do it. */
const TRASH = `ObjC.import("Foundation")
function run(argv) {
  const landed = $()
  if (!$.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(argv[0]), landed, null)) throw new Error("NOT_TRASHED")
  return ObjC.unwrap(landed.path)
}`
const RESTORE = `on run argv
  tell application "Finder"
    set moved to move (POSIX file (item 1 of argv) as alias) to (POSIX file (item 2 of argv) as alias)
    set name of moved to (item 3 of argv)
  end tell
end run`

async function trashItem(file, { exec = run } = {}) {
  const landed = (await exec('osascript', ['-l', 'JavaScript', '-e', TRASH, file])).trim()
  if (!path.isAbsolute(landed)) throw new Error('NOT_TRASHED')
  return landed
}

async function restoreItem(inBin, to, { exec = run } = {}) {
  await exec('osascript', ['-e', RESTORE, inBin, path.dirname(to), path.basename(to)])
}

module.exports = { MAX_CHARS, PICTURES, PLACES, extractText, inside, isPackage, locate, rankFound, restoreItem, run, searchArgs, trashItem, walkFind }
