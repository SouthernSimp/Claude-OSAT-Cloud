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

/* Spotlight by file name, only inside the folders OSAT may show. */
function searchArgs(query, roots) {
  return [...roots.flatMap((root) => ['-onlyin', root]), '-name', query]
}

/* Spotlight's matches as { rootId, relative, name }: inside one of the roots, never
   hidden, never inside a package. Names that start with the words come first,
   then the shallowest. */
function locate(paths, roots, query, limit = 12) {
  const needle = query.trim().toLowerCase()
  const byDepth = [...roots].sort((a, b) => b.root.length - a.root.length)
  const found = []
  for (const file of paths) {
    const root = byDepth.find((item) => file.startsWith(`${item.root}${path.sep}`))
    if (!root) continue
    const parts = file.slice(root.root.length + 1).split(path.sep)
    if (parts.some((part) => !part || part.startsWith('.')) || parts.slice(0, -1).some(isPackage)) continue
    found.push({ rootId: root.id, relative: parts.join('/'), name: parts.at(-1), depth: parts.length })
  }
  const starts = (item) => Number(item.name.toLowerCase().startsWith(needle))
  return found
    .sort((a, b) => starts(b) - starts(a) || a.depth - b.depth || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ depth, ...item }) => item)
}

module.exports = { MAX_CHARS, PICTURES, PLACES, extractText, isPackage, locate, run, searchArgs }
