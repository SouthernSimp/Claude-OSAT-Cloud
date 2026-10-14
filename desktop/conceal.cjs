/* Passwords (Phase 58): put words on the Mac's clipboard marked as concealed (nspasteboard.org's
   org.nspasteboard.ConcealedType), so clipboard managers and OSAT's own clipboard history leave them out.
   Electron's clipboard can't write a second pasteboard type next to the text (every write clears the board first),
   so this is one AppKit call in `osascript -l JavaScript`. The words travel on the program's standard input, never in its
   arguments (arguments show up in `ps`), and nothing is logged. Mac only: elsewhere it refuses, and nothing is copied. */
const { execFile } = require('node:child_process')

const SCRIPT = `
ObjC.import('AppKit');
const env = $.NSProcessInfo.processInfo.environment;
const named = env.objectForKey('OSAT_PASTEBOARD');
const board = named.isNil() ? $.NSPasteboard.generalPasteboard : $.NSPasteboard.pasteboardWithName(ObjC.unwrap(named));
const input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
const text = $.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding);
board.clearContents;
board.setStringForType(text, 'public.utf8-plain-text');
board.setDataForType($.NSData.data, 'org.nspasteboard.ConcealedType');
`

/* `pasteboard` (a name) is for the check script and tests, so they never touch the real clipboard. */
function writeConcealed(text, { platform = process.platform, run = execFile, pasteboard = '' } = {}) {
  if (platform !== 'darwin') return Promise.reject(new Error('Copying a password safely needs the Mac.'))
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    if (pasteboard) env.OSAT_PASTEBOARD = pasteboard
    else delete env.OSAT_PASTEBOARD
    const child = run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT], { timeout: 10000, env }, (error) => {
      if (error) reject(new Error('Copying a password safely didn’t work.'))
      else resolve(true)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(String(text), 'utf8')
  })
}

module.exports = { writeConcealed, SCRIPT }
