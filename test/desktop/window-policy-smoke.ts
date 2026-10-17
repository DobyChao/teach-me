import assert from 'node:assert/strict';
import type { BrowserWindow } from 'electron';
import { WindowsAdapter } from '../../src/host/windows.ts';

export class WindowStyleProbe {
  private windows = new WindowsAdapter();
  async check(panel: BrowserWindow, overlay: BrowserWindow) {
    const handle = (w: BrowserWindow) => w.getNativeWindowHandle().readBigUInt64LE().toString();
    const p = await this.windows.windowStyle(handle(panel));
    const o = await this.windows.windowStyle(handle(overlay));
    assert.ok(p & 0x00000008, 'panel remains natively WS_EX_TOPMOST');
    assert.ok(o & 0x00000008, 'overlay remains natively WS_EX_TOPMOST');
    assert.ok(p & 0x00040000, 'panel remains WS_EX_APPWINDOW');
    assert.equal(p & 0x00000080, 0, 'panel never becomes a tool window');
    assert.equal(
      !!(p & 0x08000000),
      !panel.isFocusable(),
      'inactive input retains WS_EX_NOACTIVATE',
    );
    assert.equal(o & 0x00040000, 0, 'overlay never becomes an app window');
    assert.ok(o & 0x00000080, 'overlay remains a tool window even when editable');
  }
  foreground() {
    return this.windows.foreground();
  }
  // Interactive-only fixture: expose the normally tool-only overlay to the
  // computer-use window inventory. Production roles are never changed here.
  async makeTargetable(window: BrowserWindow) {
    await this.windows.inputPolicy(
      window.getNativeWindowHandle().readBigUInt64LE().toString(),
      true,
      true,
    );
    window.setSkipTaskbar(false);
  }
  dispose() {
    this.windows.dispose();
  }
}
