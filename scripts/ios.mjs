// Opens the OSAT iPhone app in Xcode, ready to run on your iPhone:
//   npm run ios
// Needs Xcode (opened once, so its license is accepted) and XcodeGen (brew install xcodegen).
import { execFileSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options })

try {
  execFileSync('xcodegen', ['--version'], { stdio: 'ignore' })
} catch {
  console.error('XcodeGen is missing. Install it once with:\n\n  brew install xcodegen\n')
  process.exit(1)
}

run('npm', ['run', 'build'])
rmSync('ios/Web', { recursive: true, force: true })
cpSync('dist/client', 'ios/Web', { recursive: true })
run('xcodegen', ['generate'], { cwd: 'ios' })
run('open', ['ios/OSAT.xcodeproj'])
console.log(`
Xcode is opening the OSAT iPhone app. To put it on your iPhone:
  1. Plug in your iPhone (or pick it from the list at the top of Xcode).
  2. Click OSAT in the left column, then Signing & Capabilities, and pick your team.
  3. Press the Run button (the triangle). On the iPhone, allow it in
     Settings → General → VPN & Device Management the first time.
`)
