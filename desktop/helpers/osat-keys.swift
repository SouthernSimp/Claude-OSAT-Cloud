// osat-keys: presses keys for OSAT (paste, copy, a snippet's ⌫s, Lock Screen) straight into the Mac's event stream.
//
// It replaced `tell application "System Events" to keystroke …`, which also needs Automation permission (a second
// prompt that can be refused without anyone seeing it, and then paste and snippets silently did nothing). Posting
// events needs only OSAT's Accessibility.
//
//   osat-keys cmd+v                 one chord
//   osat-keys backspace*5 cmd+v     several, in order; *n repeats one
//
// Keys: a–z, 0–9, backspace, return, tab, escape, space; modifiers: cmd, ctrl, alt, shift. It posts only what it is
// given, reads nothing, writes nothing to disk and makes no network connection. Exit 1 without Accessibility.

import ApplicationServices
import Foundation

let codes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14,
    "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
    "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    "return": 36, "tab": 48, "space": 49, "backspace": 51, "escape": 53,
]
let modifiers: [String: CGEventFlags] = ["cmd": .maskCommand, "ctrl": .maskControl, "alt": .maskAlternate, "shift": .maskShift]

guard AXIsProcessTrusted() else { exit(1) }

// Parse everything first, so a bad argument presses nothing at all.
var presses: [(CGKeyCode, CGEventFlags)] = []
for argument in CommandLine.arguments.dropFirst() {
    let parts = argument.lowercased().split(separator: "*", maxSplits: 1).map(String.init)
    let times = parts.count == 2 ? Int(parts[1]) ?? 0 : 1
    let names = parts[0].split(separator: "+").map(String.init)
    guard (1...200).contains(times), let key = names.last, let code = codes[key] else { exit(2) }
    var flags: CGEventFlags = []
    for name in names.dropLast() {
        guard let flag = modifiers[name] else { exit(2) }
        flags.insert(flag)
    }
    presses += Array(repeating: (code, flags), count: times)
}

// A private source, so keys still physically held (the Hyper key after a Hyper shortcut) don't add their flags.
let source = CGEventSource(stateID: .privateState)
for (code, flags) in presses {
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
        event?.flags = flags
        event?.post(tap: .cghidEventTap)
    }
    usleep(4000)
}
