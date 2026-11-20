// Send OS-level input on Windows so the real IME composes.
// Build: csc /nologo /out:winkeys.exe winkeys.cs   (C# 5, .NET Framework csc)
// usage: winkeys [--info] [--activate TITLE_SUBSTR] [--layout KLID] [--hangul] [--imeon]
//                [--delay MS] tokens...
// tokens (harness/scenarios/vocab.mjs): a-z 0-9, SP RET BS ESC TAB LEFT RIGHT UP DOWN,
//   ASTERISK HASH MINUS PERIOD COMMA BACKTICK, MOD+<k> (Ctrl), SHIFT+<k>, WAIT:ms; and VK:0xNN, CLICK:x,y, INFO.
// Exit codes: 0 ok, 2 bad argument, 3 activation failed (no keys are sent after it), 4 SendInput failed.
// Copied from the windows spike branch (winkeys.cs) and extended for the harness.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class W {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO { public int cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] i, int cb);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint t);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint tid);
  [DllImport("user32.dll")] public static extern int GetKeyboardLayoutList(int n, IntPtr[] l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr LoadKeyboardLayout(string klid, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO g);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f, bool inh, uint acc);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr h, int idx, StringBuilder b, int n, out int need);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] public static extern bool ProcessIdToSessionId(uint pid, out uint sid);
  [DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetDefaultIMEWnd(IntPtr h);
}

static class P {
  static int delay = 120;
  static string target = null;
  static void Log(string s) { Console.Error.WriteLine(s); }

  class Fail : Exception { public int Code; public Fail(int c, string m) : base(m) { Code = c; } }

  // Arrow keys are extended keys: without KEYEVENTF_EXTENDEDKEY they arrive as the numpad keys.
  static bool Extended(ushort vk) { return vk >= 0x21 && vk <= 0x28 || vk == 0x2D || vk == 0x2E; }

  static void Key(ushort vk, bool up) {
    var i = new W.INPUT[1];
    i[0].type = 1;
    i[0].u.ki.wVk = vk;
    i[0].u.ki.wScan = (ushort)W.MapVirtualKey(vk, 0);
    i[0].u.ki.dwFlags = (up ? 2u : 0u) | (Extended(vk) ? 1u : 0u);
    uint n = W.SendInput(1, i, Marshal.SizeOf(typeof(W.INPUT)));
    if (n != 1) throw new Fail(4, string.Format("SendInput vk=0x{0:X2} failed err={1}", vk, Marshal.GetLastWin32Error()));
  }
  static void Tap(ushort vk) { Key(vk, false); Thread.Sleep(20); Key(vk, true); }

  // A zero mouse move: injected input that gives this process the right to set the foreground window.
  // (The spike tapped Alt here. Alt in Firefox can move the keyboard focus to the menu bar.)
  static void Nudge() {
    var i = new W.INPUT[1];
    i[0].type = 0; i[0].u.mi.dwFlags = 0x0001; // MOUSEEVENTF_MOVE, dx = dy = 0
    W.SendInput(1, i, Marshal.SizeOf(typeof(W.INPUT)));
  }

  // One harness token as a chord: modifiers + key.
  static void Chord(string t) {
    if (t.StartsWith("MOD+")) { Key(0x11, false); try { Chord(t.Substring(4)); } finally { Key(0x11, true); } return; }
    if (t.StartsWith("SHIFT+")) { Key(0x10, false); try { Chord(t.Substring(6)); } finally { Key(0x10, true); } return; }
    if (t == "ASTERISK") { Chord("SHIFT+8"); return; }
    if (t == "HASH") { Chord("SHIFT+3"); return; }
    Tap(Vk(t));
  }

  static void Click(int x, int y) {
    W.SetCursorPos(x, y);
    Thread.Sleep(100);
    var i = new W.INPUT[2];
    i[0].type = 0; i[0].u.mi.dwFlags = 0x0002; // LEFTDOWN
    i[1].type = 0; i[1].u.mi.dwFlags = 0x0004; // LEFTUP
    uint n = W.SendInput(2, i, Marshal.SizeOf(typeof(W.INPUT)));
    Log(string.Format("click {0},{1} sent={2} err={3}", x, y, n, Marshal.GetLastWin32Error()));
    if (n != 2) throw new Fail(4, "SendInput click failed");
  }

  static IntPtr Find(string sub) {
    IntPtr found = IntPtr.Zero;
    W.EnumWindows((h, l) => {
      if (!W.IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      W.GetWindowText(h, sb, 512);
      if (sb.ToString().Contains(sub)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static string Title(IntPtr h) { var sb = new StringBuilder(512); W.GetWindowText(h, sb, 512); return sb.ToString(); }

  static IntPtr Focus() {
    IntPtr fg = W.GetForegroundWindow();
    uint pid; uint tid = W.GetWindowThreadProcessId(fg, out pid);
    var g = new W.GUITHREADINFO(); g.cbSize = Marshal.SizeOf(typeof(W.GUITHREADINFO));
    if (W.GetGUIThreadInfo(tid, ref g) && g.hwndFocus != IntPtr.Zero) return g.hwndFocus;
    return fg;
  }

  static void Activate(string sub) {
    IntPtr h = Find(sub);
    // The browser sets the window title a little after document.title changes.
    for (int k = 0; k < 20 && h == IntPtr.Zero; k++) { Thread.Sleep(200); h = Find(sub); }
    if (h == IntPtr.Zero) throw new Fail(3, "activate: no window with title containing " + sub);
    for (int k = 0; k < 5 && W.GetForegroundWindow() != h; k++) {
      Nudge();
      uint pid; uint ft = W.GetWindowThreadProcessId(W.GetForegroundWindow(), out pid);
      uint me = W.GetCurrentThreadId();
      W.AttachThreadInput(me, ft, true);
      W.ShowWindow(h, 9);
      W.BringWindowToTop(h);
      W.SetForegroundWindow(h);
      W.AttachThreadInput(me, ft, false);
      Thread.Sleep(300);
    }
    bool ok = W.GetForegroundWindow() == h;
    Log(string.Format("activate '{0}' hwnd=0x{1:X} fg=0x{2:X} ok={3}", sub, h.ToInt64(), W.GetForegroundWindow().ToInt64(), ok));
    if (!ok) throw new Fail(3, string.Format("activate: window '{0}' is not in the foreground (fg='{1}')", Title(h), Title(W.GetForegroundWindow())));
  }

  static int ImeCtl(int cmd, int val) {
    IntPtr ime = W.ImmGetDefaultIMEWnd(Focus());
    if (ime == IntPtr.Zero) return -1;
    return W.SendMessage(ime, 0x0283, (IntPtr)cmd, (IntPtr)val).ToInt32();
  }

  static void Info(string tag) {
    IntPtr fg = W.GetForegroundWindow();
    uint pid; uint tid = W.GetWindowThreadProcessId(fg, out pid);
    Log(string.Format("[{0}] fg=0x{1:X} title='{2}' hkl=0x{3:X8} imeOpen={4} conv=0x{5:X} smode=0x{6:X}",
      tag, fg.ToInt64(), Title(fg), W.GetKeyboardLayout(tid).ToInt64() & 0xFFFFFFFF, ImeCtl(5, 0), ImeCtl(1, 0), ImeCtl(3, 0)));
  }

  // One machine-readable line per mode switch (read by harness/drivers/windows.mjs into harness.notes):
  // IMESTATE <mode> open=a>b conv=0xA>0xB smode=0xA>0xB acts=<what was changed, or none>
  static void State(string mode, int o0, int c0, int s0, List<string> acts) {
    Log(string.Format("IMESTATE {0} open={1}>{2} conv=0x{3:X}>0x{4:X} smode=0x{5:X}>0x{6:X} acts={7}",
      mode, o0, ImeCtl(5, 0), c0, ImeCtl(1, 0), s0, ImeCtl(3, 0), acts.Count > 0 ? string.Join(",", acts.ToArray()) : "none"));
  }

  static ushort Vk(string t) {
    if (t == "SP") return 0x20; if (t == "RET") return 0x0D; if (t == "BS") return 0x08;
    if (t == "ESC") return 0x1B; if (t == "TAB") return 0x09;
    if (t == "LEFT") return 0x25; if (t == "UP") return 0x26; if (t == "RIGHT") return 0x27; if (t == "DOWN") return 0x28;
    if (t == "MINUS") return 0xBD; // VK_OEM_MINUS
    if (t == "PERIOD") return 0xBE; // VK_OEM_PERIOD
    if (t == "COMMA") return 0xBC; // VK_OEM_COMMA
    // VK_OEM_3: "`" on the US and Korean layouts. On the Japanese (JIS) layout this key is "@".
    if (t == "BACKTICK") return 0xC0;
    if (t.StartsWith("VK:")) return Convert.ToUInt16(t.Substring(3), 16);
    if (t.Length == 1) { char c = char.ToUpperInvariant(t[0]); if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c; }
    throw new Fail(2, "bad token " + t);
  }

  static int Main(string[] argv) {
    try { return Run(argv); }
    catch (Fail f) { Log("error: " + f.Message); return f.Code; }
    catch (Exception e) { Log("error: " + e.Message); return 2; }
  }

  static int Run(string[] argv) {
    W.SetProcessDPIAware();
    var a = new List<string>(argv);
    for (int i = 0; i < a.Count; i++) {
      string t = a[i];
      if (t == "--delay") { delay = int.Parse(a[++i]); continue; }
      if (t == "--info" || t == "INFO") {
        uint sid; W.ProcessIdToSessionId((uint)System.Diagnostics.Process.GetCurrentProcess().Id, out sid);
        IntPtr d = W.OpenInputDesktop(0, false, 0x0100);
        var sb = new StringBuilder(256); int need;
        if (d != IntPtr.Zero) W.GetUserObjectInformation(d, 2, sb, 512, out need);
        Log(string.Format("session={0} consoleSession={1} inputDesktop='{2}' (err={3}) screen={4}x{5} interactive={6}",
          sid, W.WTSGetActiveConsoleSessionId(), sb, d == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0,
          W.GetSystemMetrics(0), W.GetSystemMetrics(1), Environment.UserInteractive));
        var l = new IntPtr[32]; int n = W.GetKeyboardLayoutList(32, l);
        var s = new StringBuilder();
        for (int k = 0; k < n; k++) s.AppendFormat("0x{0:X8} ", l[k].ToInt64() & 0xFFFFFFFF);
        Log("layouts: " + s);
        W.EnumWindows((h, lp) => {
          if (W.IsWindowVisible(h) && Title(h).Length > 0) { uint wp; W.GetWindowThreadProcessId(h, out wp); Log(string.Format("  win 0x{0:X} pid={1} '{2}'", h.ToInt64(), wp, Title(h))); }
          return true;
        }, IntPtr.Zero);
        Info("info");
        continue;
      }
      if (t == "--activate") { target = a[++i]; Activate(target); continue; }
      if (t == "--layout") {
        string klid = a[++i];
        IntPtr hkl = W.LoadKeyboardLayout(klid, 0x1); // KLF_ACTIVATE
        IntPtr f = Focus();
        W.PostMessage(W.GetForegroundWindow(), 0x0050, IntPtr.Zero, hkl); // WM_INPUTLANGCHANGEREQUEST
        Thread.Sleep(400);
        Log(string.Format("layout {0} hkl=0x{1:X8} focus=0x{2:X}", klid, hkl.ToInt64() & 0xFFFFFFFF, f.ToInt64()));
        Info("after-layout");
        continue;
      }
      if (t == "--hangul") {
        // IME_CMODE_NATIVE = 1. Toggle with VK_HANGUL only when not already in Hangul mode.
        var acts = new List<string>();
        int o0 = ImeCtl(5, 0), c0 = ImeCtl(1, 0), s0 = ImeCtl(3, 0);
        if (c0 < 0 || (c0 & 1) == 0) { Tap(0x15); Thread.Sleep(300); acts.Add("vkhangul"); }
        if ((ImeCtl(1, 0) & 1) == 0) { ImeCtl(2, ImeCtl(1, 0) | 1); Thread.Sleep(200); acts.Add("setconv"); }
        State("hangul", o0, c0, s0, acts);
        Info("after-hangul");
        continue;
      }
      if (t == "--imeon") {
        // Japanese: open the IME and select Hiragana (NATIVE|FULLSHAPE = 9).
        var acts = new List<string>();
        int o0 = ImeCtl(5, 0), c0 = ImeCtl(1, 0), s0 = ImeCtl(3, 0);
        if (ImeCtl(5, 0) != 1) { Tap(0x16); Thread.Sleep(300); acts.Add("vkimeon"); } // VK_IME_ON
        if (ImeCtl(5, 0) != 1) { ImeCtl(6, 1); Thread.Sleep(200); acts.Add("setopen"); } // IMC_SETOPENSTATUS
        // Keep IME_CMODE_ROMAN (0x10): the harness types romaji. 0x19 is the IME's own default.
        int jc = ImeCtl(1, 0);
        if (jc < 0 || (jc & 0x19) != 0x19) { ImeCtl(2, (jc < 0 ? 0 : jc) | 0x19); Thread.Sleep(200); acts.Add("setconv"); }
        // Sentence mode IME_SMODE_NONE (0) makes the IME commit every kana alone, without conversion
        // (runs 44704282096, 44704983706: every Japanese control "にほんご　", smode=0x0; Lexical windows had 0x8).
        // Set IME_SMODE_PHRASEPREDICT (8), the IME's own default.
        if (ImeCtl(3, 0) == 0) { ImeCtl(4, 8); Thread.Sleep(200); acts.Add("setsmode"); }
        State("imeon", o0, c0, s0, acts);
        Info("after-imeon");
        continue;
      }
      if (t.StartsWith("CLICK:")) {
        var xy = t.Substring(6).Split(',');
        Click(int.Parse(xy[0]), int.Parse(xy[1]));
        Thread.Sleep(300);
        continue;
      }
      if (t.StartsWith("WAIT:")) { Thread.Sleep(int.Parse(t.Substring(5))); continue; }
      Chord(t);
      Thread.Sleep(delay);
    }
    return 0;
  }
}
