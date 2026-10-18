import type { BrowserWindow, Rectangle } from 'electron';

// Windows does not implement setBounds(..., true). Retarget the same native window.
export class PanelMotion {
  private timer: ReturnType<typeof setInterval> | null = null;
  private target: Rectangle | null = null;
  private window: BrowserWindow;
  private changed: (active: boolean) => void;
  constructor(window: BrowserWindow, changed: (active: boolean) => void) {
    this.window = window;
    this.changed = changed;
  }
  move(bounds: Rectangle, animate: boolean) {
    if (this.timer && !animate) {
      this.target = bounds;
      return;
    }
    this.dispose();
    this.target = bounds;
    const from = this.window.getBounds();
    if (!animate) {
      if (Object.entries(bounds).some(([k, v]) => Math.abs(from[k as keyof Rectangle] - v) > 1))
        this.window.setBounds(bounds);
      return;
    }
    const start = performance.now();
    this.changed(true);
    this.timer = setInterval(() => {
      if (this.window.isDestroyed()) return this.dispose();
      const t = Math.min(1, (performance.now() - start) / 200);
      const eased = 1 - Math.pow(1 - t, 3);
      const target = this.target!;
      const value = (k: keyof Rectangle) => Math.round(from[k] + (target[k] - from[k]) * eased);
      const b = { x: value('x'), y: value('y'), width: value('width'), height: value('height') };
      this.window.setBounds(b);
      if (t === 1) {
        this.dispose();
        this.changed(false);
      }
    }, 16);
  }
  finish() {
    const active = this.timer !== null;
    if (!active) return;
    this.dispose();
    if (this.target && !this.window.isDestroyed()) this.window.setBounds(this.target);
    if (active) this.changed(false);
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
