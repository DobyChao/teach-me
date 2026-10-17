import type { BrowserWindow } from 'electron';
import type { WindowsAdapter } from './windows.ts';

// Electron's Windows SetFocusable also calls SetSkipTaskbar(!focusable).
// Reapply the role's taskbar policy after every focusability transition.
export async function setWindowInput(
  window: BrowserWindow,
  acceptInput: boolean,
  taskbar: boolean,
  windows: WindowsAdapter,
) {
  if (window.isFocusable() !== acceptInput) window.setFocusable(acceptInput);
  const handle = window.getNativeWindowHandle();
  await windows.taskbar(
    (handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(),
    taskbar,
  );
  if (window.isDestroyed()) return;
  window.setSkipTaskbar(!taskbar);
}
