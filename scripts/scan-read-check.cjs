/* CI on a Mac: OSAT reads the words on a scan three ways, as Paper in (Phase 15) and Ask do
   through extractText: a PDF's own text, a picture (the Mac's text recognition, Vision), and a
   PDF that is only a picture.
     node scripts/scan-read-check.cjs */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { extractText } = require('../desktop/mac-files.cjs')

/* A one-page PDF with real text on it (PDFKit repairs nothing: the offsets are exact). The
   page is painted white first, like paper: a picture made from a page with no background is
   see-through, which Vision reads as nothing and no scanner ever makes. */
function textPdf(lines) {
  const stream = `1 1 1 rg 0 0 612 792 re f 0 0 0 rg BT /F1 28 Tf 72 700 Td 36 TL ${lines.map((line) => `(${line}) Tj T*`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const at = body.length
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return at
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return body
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osat-scan-'))
  const pdf = path.join(dir, 'renewal.pdf')
  fs.writeFileSync(pdf, textPdf(['Car insurance renewal', 'Please pay by October 12', 'Policy number 4471 2209']))
  const png = path.join(dir, 'renewal.png')
  const picturePdf = path.join(dir, 'picture only.pdf')
  execFileSync('sips', ['-s', 'format', 'png', '-s', 'dpiWidth', '200', '-s', 'dpiHeight', '200', pdf, '--out', png], { stdio: 'ignore' })
  execFileSync('sips', ['-s', 'format', 'pdf', png, '--out', picturePdf], { stdio: 'ignore' })
  const failures = []
  for (const [file, how] of [[pdf, 'a PDF’s own text'], [png, 'a picture'], [picturePdf, 'a PDF that is only a picture']]) {
    const words = (await extractText(file).catch((error) => ({ text: `(${error.message})` }))).text
    console.log(`${how}: ${JSON.stringify(words.slice(0, 120))}`)
    if (!/insurance/i.test(words) || !/renewal/i.test(words)) failures.push(how)
  }
  if (failures.length) throw new Error(`no words read from ${failures.join(', ')}`)
  console.log('Scan reading check: words read from a PDF, a picture and a picture-only PDF.')
}

main().catch((error) => {
  console.error(`Scan reading check failed: ${error.message}`)
  process.exit(1)
})
