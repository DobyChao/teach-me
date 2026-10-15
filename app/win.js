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
  '[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();',
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

  dispose() {
    if (this.ps) {
      try {
        this.ps.kill();
      } catch {}
      this.ps = null;
    }
  }
}

module.exports = { WinHelper };
