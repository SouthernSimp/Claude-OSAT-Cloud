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
   PDFKit, Word and rich text through textutil. Enough to answer about, not the whole book. */
const MAX_CHARS = 12000
const RICH = new Set(['.doc', '.docx', '.htm', '.html', '.odt', '.rtf', '.rtfd', '.webarchive'])
const PDF_TEXT = 'ObjC.import("PDFKit"); function run(argv) { const d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0])); if (d.isNil()) return ""; const s = d.string; return s.isNil() ? "" : s.js.slice(0, 20000) }'

async function extractText(file, { exec = run, readText = readTextFile } = {}) {
  const ext = path.extname(file).toLowerCase()
  let text
  if (ext === '.pdf') text = await exec('osascript', ['-l', 'JavaScript', '-e', PDF_TEXT, file])
  else if (RICH.has(ext)) text = await exec('textutil', ['-convert', 'txt', '-stdout', file])
  else if (isSafeTextPreviewName(file)) text = (await readText(file)).content
  else throw new Error('UNREADABLE')
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw new Error('EMPTY')
  return { text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS }
}

/* The words on a scan (Settings → Bots → Scans), read on this Mac: a PDF's own text when it
   has some, else the Mac's own text recognition (Vision) on the image, or on the first
   pages of a PDF that is only pictures. */
const SCAN_TYPES = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.heic', '.tif', '.tiff'])
const SCAN_TEXT = `ObjC.import("PDFKit"); ObjC.import("Vision"); ObjC.import("AppKit");
function recognise(handler) {
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.usesLanguageCorrection = true;
  if (!handler.performRequestsError($.NSArray.arrayWithObject(request), null)) return "";
  const results = request.results, lines = [];
  for (let i = 0; i < results.count; i++) {
    const best = results.objectAtIndex(i).topCandidates(1);
    if (best.count) lines.push(best.objectAtIndex(0).string.js);
  }
  return lines.join("\\n");
}
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  if (!/\\.pdf$/i.test(argv[0])) return recognise($.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary)).slice(0, 20000);
  const doc = $.PDFDocument.alloc.initWithURL(url);
  if (doc.isNil()) return "";
  const own = doc.string;
  if (!own.isNil() && own.js.trim().length > 40) return own.js.slice(0, 20000);
  const pages = [];
  for (let i = 0; i < Math.min(doc.pageCount, 5); i++) {
    const page = doc.pageAtIndex(i), box = page.boundsForBox(0);
    const image = page.thumbnailOfSizeForBox($.NSMakeSize(box.size.width * 2, box.size.height * 2), 0);
    pages.push(recognise($.VNImageRequestHandler.alloc.initWithDataOptions(image.TIFFRepresentation, $.NSDictionary.dictionary)));
  }
  return pages.join("\\n\\n").slice(0, 20000);
}`

async function readScan(file, { exec = run } = {}) {
  if (!SCAN_TYPES.has(path.extname(file).toLowerCase())) throw new Error('UNREADABLE')
  const text = (await exec('osascript', ['-l', 'JavaScript', '-e', SCAN_TEXT, file], { timeout: 120000 }))
    .replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return text.slice(0, MAX_CHARS)
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

module.exports = { MAX_CHARS, PLACES, SCAN_TEXT, SCAN_TYPES, extractText, isPackage, locate, readScan, run, searchArgs }
