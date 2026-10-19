import type { BrowserWindow, Rectangle } from 'electron';

type Clock = { now: () => number; every: (tick: () => void) => () => void };
const clock: Clock = {
  now: () => performance.now(),
  every: (tick) => {
    const timer = setInterval(tick, 16);
    return () => clearInterval(timer);
  },
};

// Windows does not implement setBounds(..., true). Retarget the same native window.
export class PanelMotion {
  private cancel: (() => void) | null = null;
  private target: Rectangle | null = null;
  private window: BrowserWindow;
  private changed: (active: boolean) => void;
  private clock: Clock;
  constructor(window: BrowserWindow, changed: (active: boolean) => void, timing = clock) {
    this.window = window;
    this.changed = changed;
    this.clock = timing;
  }
  move(bounds: Rectangle, animate: boolean) {
    if (
      this.cancel &&
      animate &&
      this.target &&
      Object.entries(bounds).every(([k, v]) => this.target![k as keyof Rectangle] === v)
    )
      return;
    const active = this.cancel !== null;
    this.dispose();
    this.target = bounds;
    const from = this.window.getBounds();
    if (
      !animate ||
      Object.entries(bounds).every(([k, v]) => Math.abs(from[k as keyof Rectangle] - v) <= 1)
    ) {
      if (Object.entries(bounds).some(([k, v]) => Math.abs(from[k as keyof Rectangle] - v) > 1))
        this.window.setBounds(bounds);
      if (active) this.changed(false);
      return;
    }
    const start = this.clock.now();
    if (!active) this.changed(true);
    this.cancel = this.clock.every(() => {
      if (this.window.isDestroyed()) return this.dispose();
      const t = Math.min(1, (this.clock.now() - start) / 280);
      const eased = 1 - Math.pow(1 - t, 3);
      const target = this.target!;
      const value = (k: keyof Rectangle) => Math.round(from[k] + (target[k] - from[k]) * eased);
      const b = { x: value('x'), y: value('y'), width: value('width'), height: value('height') };
      this.window.setBounds(b);
      if (t === 1) {
        this.dispose();
        this.changed(false);
      }
    });
  }
  finish() {
    const active = this.cancel !== null;
    if (!active) return;
    this.dispose();
    if (this.target && !this.window.isDestroyed()) this.window.setBounds(this.target);
    if (active) this.changed(false);
  }
  dispose() {
    this.cancel?.();
    this.cancel = null;
  }
}
