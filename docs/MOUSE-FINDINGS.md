# Mouse findings (Phase 64)

What was learned about how a Mac mouse tool can make the wheel scroll the opposite way from the trackpad, and what OSAT does with it.

**Credit.** The method below comes from [LinearMouse](https://github.com/linearmouse/linearmouse) (MIT licence, Copyright (c) 2021-2026 LinearMouse), read as public source and, for the shipped 0.12.0 app, checked with REA (static analysis, never launched, modified or killed). OSAT's code is written again from that understanding; no blocks of its source are copied. Scroll Reverser (Nicholas Moore) is the older tool that does the same job the same way.

Two kinds of evidence are marked: **source** (LinearMouse's public repository, `main`) and **binary** (REA on `/Applications/LinearMouse.app`, 0.12.0, universal Mach-O, arm64 slice analysed; evidence ids `ev_e49a30…`, `ev_2a97bf…`, `ev_02a236…`, `ev_edd88e…`, `ev_e77261…`).

## 1. How the wheel is reversed

- **source** `EventTap/EventTap.swift`, `ReverseScrollingTransformer.swift`: a CGEventTap sees every `scrollWheel` event before the app does; the transformer changes the event in place and returns it. Reversing is multiplying the vertical and/or horizontal scroll by -1.
- **source** `EventView/ScrollWheelEventView.swift`: one scroll event carries the same step in four forms, and LinearMouse changes all of them together: the whole-line integer delta (`scrollWheelEventDeltaAxis1/2`), the fixed-point delta (`…FixedPtDeltaAxis1/2`), the point delta (`…PointDeltaAxis1/2`) and the underlying IOHID event's scroll X/Y (`CGEventCopyIOHIDEvent`, `kIOHIDEventFieldScrollX/Y`). Axis 1 is vertical, axis 2 is horizontal. After scaling, a non-zero step is rounded so it never becomes 0.
- OSAT changes the first three (the CoreGraphics fields, as Scroll Reverser does) and keeps the part a whole line cannot show (a speed of 0.5x gives every second notch). It does not touch the IOHID event: that needs private IOKit calls, and an app that reads only the IOHID value would not follow. Not seen as a problem yet; to be checked on the Mac.
- **binary**: the shipped app has the class `_TtC11LinearMouse27ReverseScrollingTransformer` and the CoreGraphics tap and field calls named in the task. Its Swift procedures are stripped of names (a search for "negate", "ReverseScrolling" finds no procedure), so function-level pseudocode for the transformer was **not obtainable by name**; the behaviour above rests on the source, and the binary only corroborates that the class and the calls exist.

## 2. Mouse or trackpad? (the question that mattered)

- **source** `Device/DeviceManager.swift`, `Device/Device.swift`: LinearMouse decides by **device**, not by event shape. `CGEventCopyIOHIDEvent(event)` then `IOHIDEventGetSenderID` gives the registry id of the HID service that sent the event; `IOHIDEventSystemClientCopyServiceForRegistryID` (and the id→device table built from `IOHIDEventSystemClient` / `IOHIDManager` registration) finds the device. A device is a **trackpad** when it conforms to HID usage page Digitizer, usage TouchPad (`device.confirmsTo(kHIDPage_Digitizer, kHIDUsage_Dig_TouchPad)`); anything else is a **mouse**, and Apple's Magic Mouse product ids are forced to mouse. Settings then apply per device category (`if.device.category`).
- **binary**: `IOHIDEventSystemClientCopyServiceForRegistryID` is imported by the 0.12.0 app (stub at `0x10029aec4`), matching the source.
- The scroll phase and momentum phase (`scrollWheelEventScrollPhase`, `scrollWheelEventMomentumPhase`) and the "continuous" flag (`scrollWheelEventIsContinuous`) are read by LinearMouse for smoothing and for ignoring its own synthetic events, not to tell mouse from trackpad.
- **What OSAT does instead (a choice, not LinearMouse's way):** the event itself decides. A trackpad (and a Magic Mouse's touch surface) sends a scroll phase while fingers move and a momentum phase while the scroll glides on; a wheel with notches sends neither. So any phase or momentum means "trackpad", otherwise "mouse wheel". Reasons: it needs no private IOKit calls, it cannot fail to find a device, and when it is wrong it is wrong on the safe side (the trackpad is never reversed by mistake; the cost is that a Magic Mouse, and a mouse driver that posts phased events, count as a trackpad). The sender-id lookup is the exact method and is the upgrade if a mouse turns out to be misread. **Not verified on a real Mac here.**

## 3. Pointer speed and acceleration (not built)

- **source** `Modules/PointerKit/…/PointerDevice.swift`: pointer speed is the HID service property `HIDPointerResolution` (a 16.16 fixed-point number, 10 to 1995, lower is faster), acceleration is `HIDPointerAcceleration` or `HIDMouseAcceleration` (the one named by `HIDPointerAccelerationType`, fixed-point 0 to 40, `-1` meaning off), and linear (no acceleration) is the integer property `HIDUseLinearScalingMouseAcceleration` (macOS Sonoma and later). They are set with `IOHIDServiceClientSetProperty` and read with `IOHIDServiceClientCopyProperty` on the device's `IOHIDServiceClient`. It is a property of the service, not an event tap multiplier.
- **binary** (`ev_2a97bf…`, `ev_02a236…`): the strings `HIDUseLinearScalingMouseAcceleration` (`0x1002efa40`), `HIDPointerResolution`, `HIDPointerAccelerationType`, `HIDPointerAcceleration`, `HIDPointerButtonCount` are in 0.12.0. This confirms the keys. **SDK headers** (IOKit `IOHIDKeys.h`) define `HIDPointerResolution`, `HIDPointerAcceleration`, `HIDPointerAccelerationType`, `HIDMouseAcceleration` and `HIDScrollAcceleration`; `HIDUseLinearScalingMouseAcceleration` is not in the public headers.
- **Why OSAT does not do it yet:** these values stay set on the device after the process that set them is gone (until the device reconnects or the Mac restarts), so a crash could leave Nate's pointer changed with no way to put it back, and the service-client calls are private IOKit. The rule "nothing stays modified after exit" cannot be kept without restoring on every path, and it could not be run here. Next step if wanted: read the originals, set only on the chosen device category, restore on every exit path and at the next start (a small state file), tested on the Mac with the wheel and pointer both checked.

## 4. Side buttons

- **source** `EventTransformer/ButtonMappingTransformer.swift`: the tap also sees `otherMouseDown/Up/Dragged`; a mapped button's press is swallowed (the tap returns nothing) and the action is run instead; the release and drags of a swallowed press are swallowed too.
- OSAT does the same for buttons 3 and above only (never left, right or middle: Hyper + middle opens the ring). Actions: back (⌘[, key code 33), forward (⌘], key code 30), or nothing. The press is posted to the HID event tap.

## 5. Staying safe

- **source** `EventTap/EventTapRecovery.swift`, `GlobalEventTapWatchdog.swift`: macOS can switch a tap off (`tapDisabledByTimeout`, `tapDisabledByUserInput`) and LinearMouse switches it on again and also checks on a timer. OSAT's helper does both.
- Accessibility: LinearMouse checks `AXIsProcessTrustedWithOptions`. OSAT's helper just tries to make the tap: no permission means no tap, and it says `denied` and does nothing else. OSAT itself only starts the helper when its own Accessibility check passes, and reuses the existing "Allow in Accessibility…" button. **Unverified:** macOS attributes the permission of a helper started by OSAT to OSAT (the way the snippets and middle-click helpers rely on); if it does not, the helper says `denied` and Settings tells Nate calmly.
- OSAT's helper changes nothing that outlives it: the only change is the tap, which ends with the process. It leaves when its input closes (OSAT quit or crashed), on SIGTERM, or when its parent changes.

## 6. Not built, and why

- **Pointer speed and acceleration** (section 3), because of the restore problem.
- **Per-app profiles** (priority 5): the tap can ask which app is under the pointer, but the settings page for it is a later step.
- **Smooth scrolling, auto-scroll, pointer-redirects-to-scroll, Logitech HID++ settings**: other LinearMouse features, not asked for.

## 7. What could not be checked here

The helper was compiled but never run (it would change the live mouse). So nothing in this document about run-time behaviour was observed: which phase values the Mac's wheel and trackpad really send, whether the permission carries over from OSAT to the helper, and how it feels. See the Mac checklist in the pull request.
