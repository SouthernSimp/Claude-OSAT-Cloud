// osat-hyper: OSAT's built-in Hyper key (Phase 63).
//
// While the trigger key (F20; OSAT turns Caps Lock into F20 with `hidutil`) is held, every other key and every mouse
// button that goes down or up leaves with ⌃⌥⇧⌘ added, so Hyper + V reaches the Mac exactly as if the four keys were
// held. The trigger itself is swallowed. The rules are shared/hyper-model.mjs `step`, which is tested; this file is the
// same rules, line for line.
//
// What it is, and is not:
//   - It reads key codes and flags, and nothing else. It never logs, stores or sends what is typed; the only words it
//     ever writes are, one per line on stdout: `ready`, `denied` (macOS has not allowed it), `deaf` (macOS let it
//     listen but sends it no keys: a stale privacy entry does that), `caps` (Caps Lock arrived as itself, so the
//     Caps Lock → F20 mapping has gone), `woke` (the Mac woke; the mapping may need putting back) and `stopped`.
//   - Self-check: once listening, it posts one F20 key-up marked as its own (swallowed like every F20) and says `ready`
//     only when that comes back through the tap. Under Secure Input no key reaches a tap, so it says `ready` unchecked.
//   - It touches nothing on disk and makes no network connection. It does not post keys, except a tap of the trigger
//     alone as Esc, when started with --tap-escape.
//   - Fail safe: if the Mac switches the tap off (too slow, or user input) it is switched back on and the held state
//     cleared; sleep, wake and a switched-out session clear it too; so does a trigger the hardware no longer has down.
//     If this program ends, the keyboard behaves normally: the flags only ever existed on events passing through it.
//
//   osat-hyper [--owner <pid>] [--tap-escape]      (it leaves when <pid> is no longer its parent)

import AppKit
import Carbon
import CoreGraphics
import Foundation

let triggerCode: Int64 = 90        // kVK_F20
let escapeCode: CGKeyCode = 53
let tapWindow: Double = 0.5        // shared/hyper-model.mjs TAP_MS
let capsCode: Int64 = 57           // kVK_CapsLock: seen only when the mapping to F20 is missing
let probeMark: Int64 = 0x05A7_0F20 // eventSourceUserData of the self-check's key
let hyperFlags: CGEventFlags = [.maskControl, .maskAlternate, .maskShift, .maskCommand]

signal(SIGPIPE, SIG_IGN)
func say(_ line: String) { print(line); fflush(stdout) }

var tapEscape = false
var owner: pid_t = 0
var arguments = CommandLine.arguments.dropFirst()
while let argument = arguments.popFirst() {
    if argument == "--tap-escape" { tapEscape = true }
    else if argument == "--owner", let value = arguments.popFirst(), let pid = Int32(value) { owner = pid }
}

// The state: { held, used, at }.
var held = false
var used = false
var heldAt: CFAbsoluteTime = 0
var tap: CFMachPort?
var heard = false
var capsSaidAt: CFAbsoluteTime = 0

func clear() { held = false; used = false }

func sendEscape() {
    for down in [true, false] {
        CGEvent(keyboardEventSource: nil, virtualKey: escapeCode, keyDown: down)?.post(tap: .cgSessionEventTap)
    }
}

let callback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        clear()
        if let tap = tap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    case .keyDown, .keyUp:
        if event.getIntegerValueField(.eventSourceUserData) == probeMark { heard = true; return nil }
        if event.getIntegerValueField(.keyboardEventKeycode) == triggerCode {
            if type == .keyDown {
                if !held { held = true; used = false; heldAt = CFAbsoluteTimeGetCurrent() }
            } else {
                let quick = held && !used && CFAbsoluteTimeGetCurrent() - heldAt <= tapWindow
                clear()
                if tapEscape && quick { sendEscape() }
            }
            return nil
        }
        if held {
            event.flags = event.flags.union(hyperFlags)
            if type == .keyDown { used = true }
        }
    case .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp:
        if held {
            event.flags = event.flags.union(hyperFlags)
            used = true
        }
    case .flagsChanged:
        // A modifier going down or up passes through exactly as it was. Caps Lock itself means the mapping is gone.
        if event.getIntegerValueField(.keyboardEventKeycode) == capsCode && CFAbsoluteTimeGetCurrent() - capsSaidAt > 2 {
            capsSaidAt = CFAbsoluteTimeGetCurrent()
            say("caps")
        }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

let types: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp]
let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }
guard let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: callback, userInfo: nil) else {
    say("denied")
    exit(0)
}
tap = port
CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0), .commonModes)
CGEvent.tapEnable(tap: port, enable: true)

func leave() -> Never {
    clear()
    say("stopped")
    exit(0)
}

// Anything that could leave the trigger half-pressed starts again from nothing.
let notifications = NSWorkspace.shared.notificationCenter
for name in [NSWorkspace.willSleepNotification, NSWorkspace.didWakeNotification, NSWorkspace.sessionDidResignActiveNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
    notifications.addObserver(forName: name, object: nil, queue: .main) { _ in clear() }
}
notifications.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in say("woke") }

var signals: [DispatchSourceSignal] = []
for number in [SIGTERM, SIGINT, SIGHUP] {
    signal(number, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { leave() }
    source.resume()
    signals.append(source)
}

// Twice a second: leave if OSAT is gone; and a hold the keyboard no longer has down (a keyboard unplugged, a missed key
// up) ends after three looks in a row, so nothing is ever left held.
var missing = 0
let watch = DispatchSource.makeTimerSource(queue: .main)
watch.schedule(deadline: .now() + 0.5, repeating: 0.5)
watch.setEventHandler {
    if owner != 0 && getppid() != owner { leave() }
    if held && !CGEventSource.keyState(.hidSystemState, key: CGKeyCode(triggerCode)) { missing += 1 } else { missing = 0 }
    if missing >= 3 { clear(); missing = 0 }
}
watch.resume()

// The self-check: one marked F20 key-up through the Mac's own event path; the tap swallows it.
if IsSecureEventInputEnabled() {
    say("ready")
} else {
    let probe = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(triggerCode), keyDown: false)
    probe?.setIntegerValueField(.eventSourceUserData, value: probeMark)
    probe?.post(tap: .cghidEventTap)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        if heard { say("ready") } else { say("deaf"); exit(0) }
    }
}
CFRunLoopRun()
