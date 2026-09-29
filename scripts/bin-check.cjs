/* CI on a Mac: "Move to Bin" puts a file in the real Bin and learns where it landed (so Undo can
   fetch it), a second file with the same name lands beside it, and both come back.
     node scripts/bin-check.cjs */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { trashItem } = require('../desktop/mac-files.cjs')

async function main() {
  if (process.platform !== 'darwin') throw new Error('This check needs a Mac.')
  const dir = fs.mkdtempSync(path.join(os.homedir(), 'osat-bin-check-'))
  const name = `osat-bin-check-${process.pid}.txt`
  const file = path.join(dir, name)
  const landed = []
  try {
    for (const text of ['first', 'second']) {
      fs.writeFileSync(file, text)
      const inBin = await trashItem(file)
      if (fs.existsSync(file)) throw new Error('The file was still where it was.')
      if (!inBin.startsWith(path.join(os.homedir(), '.Trash') + path.sep) || !fs.existsSync(inBin)) throw new Error(`The Bin did not say where the file landed: ${inBin}`)
      landed.push([inBin, text])
    }
    if (landed[0][0] === landed[1][0]) throw new Error('The second file landed on top of the first.')
    for (const [inBin, text] of landed) {
      const back = path.join(dir, `back-${text}.txt`)
      fs.renameSync(inBin, back)
      if (fs.readFileSync(back, 'utf8') !== text) throw new Error('A file came back changed.')
    }
    console.log('Bin check: two files went to the Bin, said where they landed, and came back.')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`Bin check failed: ${error.message}`)
  process.exit(1)
})
