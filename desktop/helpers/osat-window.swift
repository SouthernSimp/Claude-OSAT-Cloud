// osat-window: reads and moves the front app's focused window through Accessibility (window snapping, snap.cjs).
//
// It replaced System Events scripting, which also needs Automation permission (a second prompt that can be refused
// without anyone seeing it) and took a few hundred milliseconds a move. This needs only OSAT's Accessibility, and is
// how Raycast and Rectangle move windows.
//
//   osat-window front              → {"app":"Safari","x":0,"y":25,"width":800,"height":600}
//                                    or {"error":"NOFRONT"|"NOWINDOW"|"ACCESS","app":…}
//   osat-window move <x> <y> <w> <h> → ok   (top-left origin, points, the same numbers System Events used)
//
// It touches only the one window, writes nothing to disk and makes no network connection.

import AppKit
import ApplicationServices

func reply(_ object: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: object)
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}

func value(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var out: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &out) == .success ? out : nil
}

guard AXIsProcessTrusted() else { reply(["error": "ACCESS"]) }
guard let front = NSWorkspace.shared.frontmostApplication else { reply(["error": "NOFRONT"]) }
let appName = front.localizedName ?? ""
let app = AXUIElementCreateApplication(front.processIdentifier)
let found = value(app, kAXFocusedWindowAttribute) ?? (value(app, kAXWindowsAttribute) as? [AXUIElement])?.first
guard let windowRef = found, CFGetTypeID(windowRef) == AXUIElementGetTypeID() else { reply(["error": "NOWINDOW", "app": appName]) }
let window = windowRef as! AXUIElement

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "front" {
    var at = CGPoint.zero
    var size = CGSize.zero
    if let raw = value(window, kAXPositionAttribute) { AXValueGetValue(raw as! AXValue, .cgPoint, &at) }
    if let raw = value(window, kAXSizeAttribute) { AXValueGetValue(raw as! AXValue, .cgSize, &size) }
    reply(["app": appName, "x": Double(at.x), "y": Double(at.y), "width": Double(size.width), "height": Double(size.height)])
}

guard args.first == "move", args.count == 5, let x = Double(args[1]), let y = Double(args[2]), let w = Double(args[3]), let h = Double(args[4]) else {
    FileHandle.standardError.write("usage: osat-window front | move x y w h\n".data(using: .utf8)!)
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
