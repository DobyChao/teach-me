import { spawn } from 'node:child_process';

// Application platform adapter, kept outside the domain and renderer.
const members = `
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, System.IntPtr p);
[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr h);
public static bool Activate(System.IntPtr h) {
  if(!IsWindow(h))return false;
  uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),System.IntPtr.Zero);
  uint current=GetCurrentThreadId();
  bool attached=foreground!=0 && current!=foreground && AttachThreadInput(current,foreground,true);
  try { SetForegroundWindow(h);BringWindowToTop(h);return GetForegroundWindow()==h; }
  finally { if(attached)AttachThreadInput(current,foreground,false); }
}
`;
export class WindowsAdapter {
  private child: ReturnType<typeof spawn> | null = null;
  private pending = new Map<
    number,
    { resolve: (value: string | null) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private sequence = 0;
  private buffer = '';
  private ensure() {
    if (this.child) return;
    if (process.platform !== 'win32') throw new Error('当前桌面版本仅支持 Windows');
    const script = `Add-Type -TypeDefinition 'public class CompanionNative {${members}}'; while($null -ne ($line=[Console]::ReadLine())) { try { $q=$line|ConvertFrom-Json; $v=''; if($q.kind -eq 'fg'){$v=[CompanionNative]::GetForegroundWindow().ToInt64().ToString()}; if($q.kind -eq 'activate'){ $v=[CompanionNative]::Activate([IntPtr]([long]$q.handle)).ToString() }; if($q.kind -eq 'down'){$v=(([CompanionNative]::GetAsyncKeyState(87) -band 0x8000) -ne 0).ToString()}; [Console]::WriteLine(('@'+$q.id+'='+$v)); } catch {} }`;
    this.child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child.stdout!.on('data', (data) => {
      this.buffer += String(data);
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        const m = /^@(\d+)=(.*)$/.exec(line);
        if (!m) continue;
        const p = this.pending.get(Number(m[1]));
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(Number(m[1]));
          p.resolve(m[2]);
        }
      }
    });
    const close = () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.resolve(null);
      }
      this.pending.clear();
      this.child = null;
    };
    this.child.on('error', close);
    this.child.on('exit', close);
    this.child.stdin!.on('error', () => {});
  }
  private call(kind: string, handle?: string): Promise<string | null> {
    this.ensure();
    const id = ++this.sequence;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, 3000);
      this.pending.set(id, { resolve, timer });
      this.child!.stdin!.write(JSON.stringify({ id, kind, handle }) + '\n');
    });
  }
  foreground() {
    return this.call('fg');
  }
  async activate(handle: string | null) {
    if (handle && /^\d+$/.test(handle)) await this.call('activate', handle);
  }
  async talkDown() {
    return (await this.call('down')) === 'True';
  }
  dispose() {
    this.child?.kill();
    this.child = null;
  }
}
