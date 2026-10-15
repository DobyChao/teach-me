# Dev helper: lists the app's top-level windows with visibility, rect, topmost
# and DWM cloaking, to diagnose "I can't see the panel".
Add-Type -Namespace TMA -Name Diag -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, System.IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern int GetWindowLong(System.IntPtr h, int i);
[DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(System.IntPtr h, out uint a);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(System.IntPtr h, int a, out int v, int s);
public struct RECT { public int L, T, R, B; }
'@

$pids = @(Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object Id)
$rows = New-Object System.Collections.Generic.List[string]
$cb = [TMA.Diag+EnumProc] {
  param($h, $l)
  $p = 0
  [void][TMA.Diag]::GetWindowThreadProcessId($h, [ref]$p)
  if ($pids -contains $p) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][TMA.Diag]::GetWindowText($h, $sb, 256)
    $r = New-Object TMA.Diag+RECT
    [void][TMA.Diag]::GetWindowRect($h, [ref]$r)
    $ex = [TMA.Diag]::GetWindowLong($h, -20)
    $cloak = 0
    [void][TMA.Diag]::DwmGetWindowAttribute($h, 14, [ref]$cloak, 4)
    $aff = 0
    [void][TMA.Diag]::GetWindowDisplayAffinity($h, [ref]$aff)
    if ($sb.Length -gt 0 -or [TMA.Diag]::IsWindowVisible($h)) {
      $rows.Add(('{0,-18} visible={1,-5} topmost={2,-5} cloaked={3} affinity=0x{4:x} rect=({5},{6})-({7},{8})' -f $sb.ToString(), [TMA.Diag]::IsWindowVisible($h), (($ex -band 0x8) -ne 0), $cloak, $aff, $r.L, $r.T, $r.R, $r.B))
    }
  }
  return $true
}
[void][TMA.Diag]::EnumWindows($cb, [System.IntPtr]::Zero)
"electron pids: $($pids -join ', ')"
$rows
