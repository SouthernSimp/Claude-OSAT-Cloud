// osat-window: the app you are in, through Accessibility: its focused window (window snapping, snap.cjs) and its menus
// (Keys for this app, and pressing a menu item from the bar: menus.cjs).
//
// Moving windows replaced System Events scripting, which also needs Automation permission (a second prompt that can be
// refused without anyone seeing it) and took a few hundred milliseconds a move. This needs only OSAT's Accessibility,
// and is how Raycast and Rectangle move windows and CheatSheet reads shortcuts.
//
//   osat-window front                → {"app":"Safari","x":0,"y":25,"width":800,"height":600}
//                                      or {"error":"NOFRONT"|"NOWINDOW"|"ACCESS","app":…}
//   osat-window move <x> <y> <w> <h>   → ok   (top-left origin, points, the same numbers System Events used)
//   osat-window menus                → {"app":"Safari","items":[{"path":["File","New Tab"],"key":"⌘T"},…]}
//   osat-window press <title>…       → ok   (the menu item at that path of titles, e.g. press File "New Tab")
//
// For menus, "the app you are in" is the frontmost app or, when that is OSAT (its bar is up), the app whose window is on
// top. A window is only ever the frontmost app's.
// It reads and presses only what it is asked, writes nothing to disk and makes no network connection.

import AppKit
import ApplicationServices

func reply(_ object: Any) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: object)
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}

func value(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var out: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &out) == .success ? out : nil
}

func children(_ element: AXUIElement) -> [AXUIElement] { (value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }

guard AXIsProcessTrusted() else { reply(["error": "ACCESS"]) }

func appYouAreIn() -> NSRunningApplication? {
    let me = ProcessInfo.processInfo.processIdentifier
    let osat = NSRunningApplication(processIdentifier: getppid())?.bundleIdentifier ?? "ai.mccreery.osat"
    if let front = NSWorkspace.shared.frontmostApplication, front.bundleIdentifier != osat { return front }
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for window in windows where (window[kCGWindowLayer as String] as? Int) == 0 {
        guard let pid = window[kCGWindowOwnerPID as String] as? pid_t, pid != me,
              let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier != osat, app.activationPolicy == .regular else { continue }
        return app
    }
    return nil
}

let args = Array(CommandLine.arguments.dropFirst())
// Menus are for the app behind OSAT's bar; a window is moved only when its app is really in front (never OSAT's own).
let menusWanted = args.first == "menus" || args.first == "press"
guard let front = menusWanted ? appYouAreIn() : NSWorkspace.shared.frontmostApplication else { reply(["error": "NOFRONT"]) }
let appName = front.localizedName ?? ""
let app = AXUIElementCreateApplication(front.processIdentifier)

// ---- Menus ----

// The Mac's menu glyphs (Carbon's kMenu…Glyph) and key codes for keys that have no character.
let glyphs: [Int: String] = [0x02: "⇥", 0x04: "⌤", 0x09: "Space", 0x0A: "⌦", 0x0B: "↩", 0x17: "⌫", 0x1B: "⎋", 0x62: "⇞", 0x6B: "⇟",
                             0x64: "←", 0x65: "→", 0x68: "↑", 0x6A: "↓", 0x66: "↖", 0x67: "↘", 0x6F: "F1", 0x70: "F2", 0x71: "F3", 0x72: "F4",
                             0x73: "F5", 0x74: "F6", 0x75: "F7", 0x76: "F8", 0x77: "F9", 0x78: "F10", 0x79: "F11", 0x7A: "F12", 0x8A: "fn"]
let keyCodes: [Int: String] = [36: "↩", 48: "⇥", 49: "Space", 51: "⌫", 53: "⎋", 117: "⌦", 123: "←", 124: "→", 125: "↓", 126: "↑",
                               116: "⇞", 121: "⇟", 115: "↖", 119: "↘", 122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6",
                               98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12"]

func shortcut(_ item: AXUIElement) -> String? {
    var key = (value(item, "AXMenuItemCmdChar") as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    // A control character (⌫ comes as 0x08) is named by its glyph or key code instead.
    if key.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) { key = "" }
    if key.isEmpty, let glyph = value(item, "AXMenuItemCmdGlyph") as? Int, let name = glyphs[glyph] { key = name }
    if key.isEmpty, let code = value(item, "AXMenuItemCmdVirtualKey") as? Int, let name = keyCodes[code] { key = name }
    guard !key.isEmpty else { return nil }
    // kAXMenuItemModifier…: Shift 1, Option 2, Control 4, No Command 8, and 16 the Globe (fn) key. The Mac's order: 🌐⌃⌥⇧⌘.
    let mods = (value(item, "AXMenuItemCmdModifiers") as? Int) ?? 0
    var out = mods & 16 != 0 ? "🌐" : ""
    if mods & 4 != 0 { out += "⌃" }
    if mods & 2 != 0 { out += "⌥" }
    if mods & 1 != 0 { out += "⇧" }
    if mods & 8 == 0 { out += "⌘" }
    return out + key.uppercased()
}

var items: [[String: Any]] = []
func walk(_ menu: AXUIElement, _ path: [String], _ depth: Int) {
    guard depth < 4, items.count < 2000 else { return }
    for item in children(menu) {
        let title = (value(item, kAXTitleAttribute) as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        let submenu = children(item).first { (value($0, kAXRoleAttribute) as? String) == "AXMenu" }
        if let submenu = submenu, !title.isEmpty { walk(submenu, path + [title], depth + 1); continue }
        guard !title.isEmpty, (value(item, kAXEnabledAttribute) as? Bool) != false else { continue }
        var entry: [String: Any] = ["path": path + [title]]
        if let key = shortcut(item) { entry["key"] = key }
        items.append(entry)
    }
}

func menuBarItems() -> [AXUIElement] {
    guard let barRef = value(app, kAXMenuBarAttribute), CFGetTypeID(barRef) == AXUIElementGetTypeID() else { return [] }
    // The first is the Apple menu: it is the Mac's, not the app's.
    return Array(children(barRef as! AXUIElement).dropFirst())
}

if args.first == "menus" {
    for top in menuBarItems() {
        let title = (value(top, kAXTitleAttribute) as? String) ?? ""
        for menu in children(top) where (value(menu, kAXRoleAttribute) as? String) == "AXMenu" { walk(menu, [title], 1) }
    }
    reply(["app": appName, "items": items])
}

if args.first == "press" {
    var level = menuBarItems()
    var target: AXUIElement?
    for (index, title) in args.dropFirst().enumerated() {
        guard let found = level.first(where: { (value($0, kAXTitleAttribute) as? String)?.trimmingCharacters(in: .whitespaces) == title }) else { reply(["error": "NOTFOUND", "app": appName]) }
        target = found
        if index < args.count - 2 { level = children(found).filter { (value($0, kAXRoleAttribute) as? String) == "AXMenu" }.flatMap(children) }
    }
    guard let item = target, args.count >= 3 else { reply(["error": "NOTFOUND", "app": appName]) }
    // The app comes forward first, so what the item does happens there.
    front.activate()
    usleep(120000)
    reply(AXUIElementPerformAction(item, kAXPressAction as CFString) == .success ? ["ok": true, "app": appName] : ["error": "FAILED", "app": appName])
}

// ---- The focused window ----

let found = value(app, kAXFocusedWindowAttribute) ?? (value(app, kAXWindowsAttribute) as? [AXUIElement])?.first
guard let windowRef = found, CFGetTypeID(windowRef) == AXUIElementGetTypeID() else { reply(["error": "NOWINDOW", "app": appName]) }
let window = windowRef as! AXUIElement

if args.first == "front" {
    var at = CGPoint.zero
    var size = CGSize.zero
    if let raw = value(window, kAXPositionAttribute) { AXValueGetValue(raw as! AXValue, .cgPoint, &at) }
    if let raw = value(window, kAXSizeAttribute) { AXValueGetValue(raw as! AXValue, .cgSize, &size) }
    reply(["app": appName, "x": Double(at.x), "y": Double(at.y), "width": Double(size.width), "height": Double(size.height)])
}

guard args.first == "move", args.count == 5, let x = Double(args[1]), let y = Double(args[2]), let w = Double(args[3]), let h = Double(args[4]) else {
    FileHandle.standardError.write("usage: osat-window front | move x y w h | menus | press <title>…\n".data(using: .utf8)!)
    exit(2)
}
// Apps with "enhanced user interface" on (Chrome, Electron apps while VoiceOver-ish tools run) animate every change and
// end up in the wrong place; it is switched off for the move and back on after, as Rectangle does.
let enhanced = (value(app, "AXEnhancedUserInterface") as? Bool) == true
if enhanced { AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse) }
var size = CGSize(width: w, height: h)
var at = CGPoint(x: x, y: y)
// Size, place, size again: a window too big for where it is going can't be placed until it is smaller.
AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &at)!)
AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
if enhanced { AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue) }
print("ok")
