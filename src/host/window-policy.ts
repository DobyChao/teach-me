import type { BrowserWindow } from 'electron';
import type { WindowsAdapter } from './windows.ts';

// Keep Electron's activation delegate stable. NOACTIVATE gates mouse activation
// until capture completes without removing/readding taskbar tabs.
const taskbarRoles = new WeakMap<BrowserWindow, boolean>();
export async function setWindowInput(
  window: BrowserWindow,
  acceptInput: boolean,
  taskbar: boolean,
  windows: WindowsAdapter,
) {
  const handle = window.getNativeWindowHandle();
  await windows.inputPolicy(
    (handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(),
    taskbar,
    acceptInput,
  );
  if (window.isDestroyed()) return;
  if (taskbarRoles.get(window) !== taskbar) {
    window.setSkipTaskbar(!taskbar);
    taskbarRoles.set(window, taskbar);
  }
}
