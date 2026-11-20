// Send OS-level key events so the real macOS input method composes.
// usage: oskeys [--enable ID] [--source ID] [--activate PATH_SUBSTR] [--delay MS] [--list x] tokens...
// tokens: single chars (a-z 0-9 ; ' , . / [ ] - =), SP RET BS ESC TAB LEFT RIGHT UP DOWN,
//   the harness symbols ASTERISK HASH MINUS (US layout: Shift+8, Shift+3, -),
//   CMDZ CMDSHIFTZ, modifier combos M+...+KEY with M in MOD CMD SHIFT OPT CTRL (MOD = Cmd, as in
//   harness/scenarios/vocab.mjs; e.g. MOD+b, OPT+SHIFT+RIGHT),
//   CLICK:x,y  WAIT:ms  SRC:<inputSourceID> (select an input source mid-sequence)
// Build: swiftc -O harness/native/oskeys.swift -o oskeys
import Carbon
import Cocoa

let keyCodes: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
  "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
  "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28,
  "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "RET": 36, "l": 37,
  "j": 38, "'": 39, "k": 40, ";": 41, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47,
  "TAB": 48, "SP": 49, "BS": 51, "ESC": 53,
  "LEFT": 123, "RIGHT": 124, "DOWN": 125, "UP": 126, "MINUS": 27,
]
// Symbol tokens that need Shift on the US layout.
let shiftedKeys: [String: CGKeyCode] = ["ASTERISK": 28, "HASH": 20]
let arrowCodes: Set<CGKeyCode> = [123, 124, 125, 126]
let modFlags: [String: CGEventFlags] = [
  "MOD": .maskCommand, "CMD": .maskCommand, "SHIFT": .maskShift, "OPT": .maskAlternate, "CTRL": .maskControl,
]

func currentSource() -> String {
  let s = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
  let p = TISGetInputSourceProperty(s, kTISPropertyInputSourceID)!
  return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String
}

func selectSource(_ id: String) -> Bool {
  let filter = [kTISPropertyInputSourceID as String: id] as CFDictionary
  guard let list = TISCreateInputSourceList(filter, false)?.takeRetainedValue() as? [TISInputSource],
    let s = list.first
  else { return false }
  return TISSelectInputSource(s) == noErr
}

func post(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
  let src = CGEventSource(stateID: .hidSystemState)
  for down in [true, false] {
    let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)!
    // Hardware arrow keys carry the numeric-pad and fn flags.
    e.flags = arrowCodes.contains(code) ? flags.union([.maskNumericPad, .maskSecondaryFn]) : flags
    e.post(tap: .cghidEventTap)
    usleep(15_000)
  }
}

var args = Array(CommandLine.arguments.dropFirst())
var delay: UInt32 = 120
var activateTarget: String? = nil
func activateApp(_ v: String) -> Bool {
  let apps = NSWorkspace.shared.runningApplications.filter {
    ($0.executableURL?.path ?? "").contains(v)
  }
  for app in apps { app.activate() }
  usleep(400_000)
  let front = NSWorkspace.shared.frontmostApplication
  FileHandle.standardError.write("activate \(v) matched=\(apps.count) front=\(front?.localizedName ?? "?")\n".data(using: .utf8)!)
  return (front?.executableURL?.path ?? "").contains(v)
}
FileHandle.standardError.write("AXIsProcessTrusted=\(AXIsProcessTrusted())\n".data(using: .utf8)!)
while let a = args.first, a.hasPrefix("--") {
  args.removeFirst()
  let v = args.removeFirst()
  switch a {
  case "--enable":
    let filter = [kTISPropertyInputSourceID as String: v] as CFDictionary
    let list = (TISCreateInputSourceList(filter, true)?.takeRetainedValue() as? [TISInputSource]) ?? []
    let st = list.first.map { TISEnableInputSource($0) } ?? -1
    usleep(500_000)
    FileHandle.standardError.write("enable \(v) found=\(list.count) status=\(st)\n".data(using: .utf8)!)
  case "--list":
    let all = (TISCreateInputSourceList(nil, false)?.takeRetainedValue() as? [TISInputSource]) ?? []
    for s in all {
      let p = TISGetInputSourceProperty(s, kTISPropertyInputSourceID)!
      FileHandle.standardError.write("src \(Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue())\n".data(using: .utf8)!)
    }
  case "--source":
    let ok = selectSource(v)
    usleep(200_000)
    FileHandle.standardError.write("select \(v) ok=\(ok) now=\(currentSource())\n".data(using: .utf8)!)
  case "--activate":
    activateTarget = v
    // Never type into the wrong app (for example the terminal).
    if !activateApp(v) {
      FileHandle.standardError.write("ABORT: target is not frontmost\n".data(using: .utf8)!)
      exit(3)
    }
  case "--delay":
    delay = UInt32(v)!
  default:
    break
  }
}
for t in args {
  if t.hasPrefix("CLICK:") {
    let xy = t.dropFirst(6).split(separator: ",").map { Double($0)! }
    let p = CGPoint(x: xy[0], y: xy[1])
    let src = CGEventSource(stateID: .hidSystemState)
    for type in [CGEventType.leftMouseDown, .leftMouseUp] {
      CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!
        .post(tap: .cghidEventTap)
      usleep(40_000)
    }
    usleep(300_000)
    continue
  }
  if t.hasPrefix("SRC:") {
    let id = String(t.dropFirst(4))
    let ok = selectSource(id)
    usleep(300_000)
    // Re-activate the target so it picks up the new input source, then let the input method settle.
    if let v = activateTarget, !activateApp(v) {
      FileHandle.standardError.write("ABORT: target is not frontmost\n".data(using: .utf8)!)
      exit(3)
    }
    usleep(1_000_000)
    FileHandle.standardError.write("select \(id) ok=\(ok) now=\(currentSource())\n".data(using: .utf8)!)
    if !ok || currentSource() != id {
      FileHandle.standardError.write("ABORT: input source switch failed\n".data(using: .utf8)!)
      exit(4)
    }
    continue
  }
  if t.hasPrefix("WAIT:") {
    usleep(UInt32(t.dropFirst(5))! * 1000)
    continue
  }
  switch t {
  case "CMDZ": post(6, .maskCommand)
  case "CMDSHIFTZ": post(6, [.maskCommand, .maskShift])
  case _ where t.count > 1 && t.contains("+"):
    let parts = t.split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    for m in parts.dropLast() {
      guard let f = modFlags[m] else {
        FileHandle.standardError.write("unknown modifier \(m) in \(t)\n".data(using: .utf8)!)
        exit(2)
      }
      flags.insert(f)
    }
    if let c = shiftedKeys[parts.last!] {
      post(c, flags.union(.maskShift))
    } else if let c = keyCodes[parts.last!] {
      post(c, flags)
    } else {
      FileHandle.standardError.write("unknown key in \(t)\n".data(using: .utf8)!)
      exit(2)
    }
  case _ where shiftedKeys[t] != nil:
    post(shiftedKeys[t]!, .maskShift)
  default:
    guard let c = keyCodes[t] else {
      FileHandle.standardError.write("unknown token \(t)\n".data(using: .utf8)!)
      exit(2)
    }
    post(c)
  }
  usleep(delay * 1000)
}
FileHandle.standardError.write("done source=\(currentSource())\n".data(using: .utf8)!)
