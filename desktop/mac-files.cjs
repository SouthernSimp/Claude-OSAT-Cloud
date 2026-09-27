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

module.exports = { MAX_CHARS, PLACES, extractText, isPackage, locate, run, searchArgs }
