// OSAT's mouse helper (Phase 64). Started by desktop/launcher/mouse.cjs only while Mouse is on in Settings and OSAT is
// allowed in Accessibility. It watches scroll-wheel events (and, if asked, the side buttons) and changes them on the way
// to the app under the pointer: which way the wheel scrolls, how fast, and what a side button does.
//
// What it promises:
// - It says only three words on standard output, `ready`, `denied` and `stopped`, one per line. It writes nothing else
//   anywhere: no log, no file, no network, no record of what was scrolled or clicked.
// - It changes nothing that outlives it. The only change is the event tap, which goes when this process does. It leaves
//   when OSAT closes its input, when OSAT stops (SIGTERM) or when OSAT is gone (its parent changed).
// - If macOS switches the tap off (it was too slow, or the user input was disabled), it switches it on again.
// - A trackpad is told apart from a mouse wheel by the scroll phase: fingers on a trackpad send one, a wheel with notches
//   never does. Anything with a phase is treated as a trackpad (the side that fails safe).
//
// The rules are written again from shared/mouse-model.mjs (`deviceOf`, `scrollAxis`, `buttonAction`), which has the tests.
// The idea of doing this with an event tap, and of changing the whole-line, fixed-point and point deltas together, comes
// from LinearMouse (MIT, github.com/linearmouse/linearmouse); this is written again, not copied. See docs/MOUSE-FINDINGS.md.

import CoreGraphics
import Foundation

// ---- what to do (set by the JSON line OSAT sends on standard input) ----

struct Axes {
    var vertical = false
    var horizontal = false
}

struct Rules {
    var mouse = Axes()
    var trackpad = Axes()
    var speed = 1.0
    var buttons: [Int64: String] = [:]
}

var rules = Rules()
var tap: CFMachPort?
let owner = getppid()
// The part of a whole-line step a speed could not show yet (mouse_model's `residual`), per axis.
var residualVertical = 0.0
var residualHorizontal = 0.0
// Buttons whose press was swallowed, so their release and drag are swallowed too.
var swallowed = Set<Int64>()

func say(_ word: String) {
    FileHandle.standardOutput.write(Data((word + "\n").utf8))
}

func finish() -> Never {
    if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
    say("stopped")
    exit(0)
}

func readRules(_ line: String) {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    var next = Rules()
    func axes(_ value: Any?) -> Axes {
        let table = value as? [String: Any]
        return Axes(vertical: table?["vertical"] as? Bool ?? false, horizontal: table?["horizontal"] as? Bool ?? false)
    }
    let reverse = object["reverse"] as? [String: Any]
    next.mouse = axes(reverse?["mouse"])
    next.trackpad = axes(reverse?["trackpad"])
    if let speed = object["speed"] as? Double, speed >= 0.5, speed <= 4 { next.speed = speed }
    for (key, action) in (object["buttons"] as? [String: Any]) ?? [:] {
        // Only the side buttons: never left, right or middle.
        if let button = Int64(key), button >= 3, button <= 31, let name = action as? String, ["back", "forward", "nothing"].contains(name) {
            next.buttons[button] = name
        }
    }
    rules = next
    residualVertical = 0
    residualHorizontal = 0
}

// ---- scrolling ----

/// One axis of a scroll event. The Mac sends the step three ways (whole lines, fixed point, points); all three change
/// together or an app reading the other one would scroll the old way.
func changeAxis(_ event: CGEvent, line: CGEventField, fixed: CGEventField, point: CGEventField, reverse: Bool, factor: Double, residual: inout Double) {
    if !reverse && factor == 1 {
        residual = 0
        return
    }
    let sign = reverse ? -1.0 : 1.0
    let lines = Double(event.getIntegerValueField(line))
    let wanted = lines * sign * factor
    var carried = residual
    if wanted != 0 && carried != 0 && (wanted < 0) != (carried < 0) { carried = 0 }
    let total = wanted + carried
    let whole = total.rounded(.towardZero)
    residual = total - whole
    event.setIntegerValueField(line, value: Int64(whole))
    event.setDoubleValueField(fixed, value: event.getDoubleValueField(fixed) * sign * factor)
    event.setDoubleValueField(point, value: event.getDoubleValueField(point) * sign * factor)
}

func changeScroll(_ event: CGEvent) {
    let phase = event.getIntegerValueField(.scrollWheelEventScrollPhase)
    let momentum = event.getIntegerValueField(.scrollWheelEventMomentumPhase)
    let touch = phase != 0 || momentum != 0
    let reverse = touch ? rules.trackpad : rules.mouse
    let factor = touch ? 1.0 : rules.speed
    changeAxis(event, line: .scrollWheelEventDeltaAxis1, fixed: .scrollWheelEventFixedPtDeltaAxis1, point: .scrollWheelEventPointDeltaAxis1,
               reverse: reverse.vertical, factor: factor, residual: &residualVertical)
    changeAxis(event, line: .scrollWheelEventDeltaAxis2, fixed: .scrollWheelEventFixedPtDeltaAxis2, point: .scrollWheelEventPointDeltaAxis2,
               reverse: reverse.horizontal, factor: factor, residual: &residualHorizontal)
}

// ---- side buttons ----

/// ⌘[ and ⌘] (key codes 33 and 30), as BUTTON_KEYS in the model.
func press(code: CGKeyCode) {
    for down in [true, false] {
        guard let key = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { continue }
        key.flags = .maskCommand
        key.post(tap: .cghidEventTap)
    }
}

/// Returns true when the event was dealt with here and must not go on.
func changeButton(_ event: CGEvent, type: CGEventType) -> Bool {
    let button = event.getIntegerValueField(.mouseEventButtonNumber)
    if type == .otherMouseDown {
        guard let action = rules.buttons[button] else { return false }
        swallowed.insert(button)
        if action == "back" { press(code: 33) } else if action == "forward" { press(code: 30) }
        return true
    }
    guard swallowed.contains(button) else { return false }
    if type == .otherMouseUp { swallowed.remove(button) }
    return true
}

// ---- the tap ----

let callback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // macOS switched it off; switch it on again and let the event go on as it was.
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .scrollWheel:
        changeScroll(event)
    case .otherMouseDown, .otherMouseUp, .otherMouseDragged:
        if changeButton(event, type: type) { return nil }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

func bit(_ type: CGEventType) -> CGEventMask { CGEventMask(1) << CGEventMask(type.rawValue) }

signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)
signal(SIGHUP, SIG_IGN)
let signals = [SIGTERM, SIGINT, SIGHUP].map { number -> DispatchSourceSignal in
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { finish() }
    source.resume()
    return source
}

// A tap that changes events needs Accessibility; without it the Mac gives none.
guard let made = CGEvent.tapCreate(
    tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
    eventsOfInterest: bit(.scrollWheel) | bit(.otherMouseDown) | bit(.otherMouseUp) | bit(.otherMouseDragged),
    callback: callback, userInfo: nil
) else {
    say("denied")
    exit(0)
}
tap = made
CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, made, 0), .commonModes)
CGEvent.tapEnable(tap: made, enable: true)

// OSAT's settings arrive as one JSON line each; its closing the input means OSAT is done with this helper.
var pending = Data()
FileHandle.standardInput.readabilityHandler = { handle in
    let chunk = handle.availableData
    if chunk.isEmpty {
        DispatchQueue.main.async { finish() }
        return
    }
    pending.append(chunk)
    while let newline = pending.firstIndex(of: 10) {
        let line = String(decoding: pending[pending.startIndex..<newline], as: UTF8.self)
        pending.removeSubrange(pending.startIndex...newline)
        DispatchQueue.main.async { readRules(line) }
    }
}

// Every second: still on? still wanted? macOS can switch a tap off without telling it, and OSAT may have died.
let watch = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    if getppid() != owner { finish() }
    if let tap, !CGEvent.tapIsEnabled(tap: tap) { CGEvent.tapEnable(tap: tap, enable: true) }
}
_ = watch

say("ready")
CFRunLoopRun()
