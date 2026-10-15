// A warm PowerShell process that calls a few user32 functions for us:
// Win+H (Windows voice typing), and remembering / restoring the foreground
// window so focus goes back to the app the user is learning.
const { spawn } = require('child_process');

const MEMBERS = [
  '[DllImport("user32.dll")] static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);',
  '[DllImport("user32.dll")] static extern System.IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] static extern bool SetForegroundWindow(System.IntPtr h);',
  '[DllImport("user32.dll")] static extern bool IsWindow(System.IntPtr h);',
  '[DllImport("user32.dll")] static extern bool IsIconic(System.IntPtr h);',
  '[DllImport("user32.dll")] static extern bool BringWindowToTop(System.IntPtr h);',
  '[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(System.IntPtr h, System.IntPtr pid);',
  '[DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);',
  '[DllImport("user32.dll")] static extern bool GetWindowRect(System.IntPtr h, out RECT r);',
  '[DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);',
  '[DllImport("user32.dll")] static extern short GetAsyncKeyState(int v);',
  '[DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);',
  '[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();',
  'public struct RECT { public int L; public int T; public int R; public int B; }',
  'public struct POINT { public int X; public int Y; }',
  'public static void WinH() {',
  '  keybd_event(0x5B, 0, 0, System.UIntPtr.Zero); keybd_event(0x48, 0, 0, System.UIntPtr.Zero);',
  '  keybd_event(0x48, 0, 2, System.UIntPtr.Zero); keybd_event(0x5B, 0, 2, System.UIntPtr.Zero); }',
  'public static long Fg() { return GetForegroundWindow().ToInt64(); }',
  // This process is never the foreground one, so SetForegroundWindow is only
  // honoured while our input queue is attached to the foreground thread.
  'public static bool Activate(long h) {',
  '  var p = new System.IntPtr(h);',
  '  if (h == 0 || !IsWindow(p) || IsIconic(p)) return false;',
  '  uint ft = GetWindowThreadProcessId(GetForegroundWindow(), System.IntPtr.Zero);',
  '  uint me = GetCurrentThreadId();',
  '  bool att = ft != 0 && ft != me && AttachThreadInput(me, ft, true);',
  '  bool ok = SetForegroundWindow(p); BringWindowToTop(p);',
  '  if (att) AttachThreadInput(me, ft, false);',
  '  return ok || GetForegroundWindow() == p; }',
  'public static bool Down(int v) { return (GetAsyncKeyState(v) & 0x8000) != 0; }',
  'public static string Proc(long hwnd) {',
  '  var mem = System.Runtime.InteropServices.Marshal.AllocHGlobal(4);',
  '  GetWindowThreadProcessId(new System.IntPtr(hwnd), mem);',
  '  int id = System.Runtime.InteropServices.Marshal.ReadInt32(mem);',
  '  System.Runtime.InteropServices.Marshal.FreeHGlobal(mem);',
  '  if (id == 0) return "";',
  '  try { return System.Diagnostics.Process.GetProcessById(id).ProcessName; } catch { return ""; } }',
  'public static string Bounds(long hwnd) {',
  '  RECT r = new RECT();',
  '  if (!GetWindowRect(new System.IntPtr(hwnd), out r)) return "";',
  '  return r.L + "," + r.T + "," + (r.R - r.L) + "," + (r.B - r.T); }',
  'public static string Cursor() { POINT p = new POINT(); if (!GetCursorPos(out p)) return ""; return p.X + "," + p.Y; }',
  'public static string Title(long hwnd) {',
  '  var sb = new System.Text.StringBuilder(512);',
  '  GetWindowText(new System.IntPtr(hwnd), sb, sb.Capacity);',
  '  return sb.ToString(); }',
].join(' ');

const DEFINE = `Add-Type -Namespace TMA -Name W -MemberDefinition '${MEMBERS}'`;

class WinHelper {
  constructor(log = () => {}) {
    this.log = log;
    this.ps = null;
    this.seq = 0;
    this.pending = new Map();
    this.buf = '';
    this.supported = process.platform === 'win32';
  }

  ensure() {
    if (!this.supported) return false;
    if (this.ps && this.ps.exitCode === null && !this.ps.killed) return true;
    this.ps = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.ps.on('error', (e) => this.log('win helper error: ' + e.message));
    this.ps.on('exit', () => {
      for (const p of this.pending.values()) p.resolve(null);
      this.pending.clear();
    });
    this.ps.stderr.on('data', (d) => this.log('win helper: ' + String(d).trim()));
    this.ps.stdout.on('data', (d) => this.onData(String(d)));
    this.ps.stdin.write(DEFINE + '\n');
    return true;
  }

  onData(s) {
    this.buf += s;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      const m = /^@@(\d+)=(.*)$/.exec(line);
      if (!m) continue;
      const p = this.pending.get(Number(m[1]));
      if (p) {
        this.pending.delete(Number(m[1]));
        clearTimeout(p.timer);
        p.resolve(m[2]);
      }
    }
  }

  call(expr, timeoutMs = 3000) {
    if (!this.ensure()) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.ps.stdin.write(`Write-Output ("@@${id}=" + (${expr}))\n`);
    });
  }

  warm() {
    return this.call('[TMA.W]::Fg()', 10000);
  }

  dictate() {
    return this.call('[TMA.W]::WinH()');
  }

  async foreground() {
    const v = await this.call('[TMA.W]::Fg()', 800);
    return v && /^\d+$/.test(v) ? v : null;
  }

  async activate(hwnd) {
    if (!hwnd) return false;
    return (await this.call(`[TMA.W]::Activate(${Number(hwnd)})`, 800)) === 'True';
  }

  // Lightweight capture context. The window title is read only when the caller
  // passes includeTitle — v1 does not query an accessibility tree.
  async captureContext({ includeTitle = false } = {}) {
    if (!this.supported) return { focusedProcess: null, mouse: null, foregroundBounds: null };
    const fg = await this.call('[TMA.W]::Fg()', 800);
    const hwnd = fg && /^\d+$/.test(fg) ? fg : '0';
    const proc = await this.call(`[TMA.W]::Proc(${hwnd})`, 1200);
    const bounds = await this.call(`[TMA.W]::Bounds(${hwnd})`, 800);
    const mouse = await this.call('[TMA.W]::Cursor()', 800);
    const ctx = {
      focusedProcess: proc || null,
      mouse: parsePair(mouse),
      foregroundBounds: parseRect(bounds),
    };
    if (includeTitle) ctx.windowTitle = (await this.call(`[TMA.W]::Title(${hwnd})`, 800)) || null;
    return ctx;
  }

  async chordDown(vks) {
    if (!this.supported || !vks || !vks.length) return null;
    const expr = vks.map((v) => `[TMA.W]::Down(${Number(v)})`).join('+" "+');
    const raw = await this.call(expr, 600);
    if (raw == null) return null;
    const parts = String(raw).trim().split(/\s+/);
    if (parts.length !== vks.length) return null;
    return parts.every((p) => p === 'True');
  }

  dispose() {
    if (this.ps) {
      try {
        this.ps.kill();
      } catch {}
      this.ps = null;
    }
  }
}

function parseRect(s) {
  if (!s) return null;
  const n = String(s).split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null;
  return { x: n[0], y: n[1], width: n[2], height: n[3] };
}

function parsePair(s) {
  if (!s) return null;
  const n = String(s).split(',').map(Number);
  if (n.length !== 2 || n.some((x) => !Number.isFinite(x))) return null;
  return { x: n[0], y: n[1] };
}

module.exports = { WinHelper };
