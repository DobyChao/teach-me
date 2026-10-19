import type { BrowserWindow, Rectangle } from 'electron';
import type { PanelTransition } from '../shared/protocol.ts';

type Clock = { now(): number; later(tick: () => void, ms: number): () => void };
const clock: Clock = {
  now: () => performance.now(),
  later: (tick, ms) => {
    const timer = setTimeout(tick, ms);
    return () => clearTimeout(timer);
  },
};
const equal = (a: Rectangle, b: Rectangle) =>
  (['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(a[key] - b[key]) <= 1);

// Reserve once; Chromium animates the visual frame. Never resize a transparent HWND each frame.
export class PanelMotion {
  transition: PanelTransition | null = null;
  private cancel: (() => void) | null = null;
  private target: Rectangle | null = null;
  private from: Rectangle | null = null;
  private started = 0;
  private sequence = 0;
  private window: BrowserWindow;
  private changed: (active: boolean) => void;
  private clock: Clock;
  constructor(window: BrowserWindow, changed: (active: boolean) => void, timing = clock) {
    this.window = window;
    this.changed = changed;
    this.clock = timing;
  }
  get destination(): Rectangle | null {
    return this.target ? { ...this.target } : null;
  }
  private visualBounds(): Rectangle {
    if (!this.transition || !this.from || !this.target) return this.window.getBounds();
    const p = Math.min(1, (this.clock.now() - this.started) / this.transition.duration);
    const eased = 1 - (1 - p) ** 3;
    const v = (key: keyof Rectangle) =>
      this.from![key] + (this.target![key] - this.from![key]) * eased;
    return { x: v('x'), y: v('y'), width: v('width'), height: v('height') };
  }
  move(bounds: Rectangle, animate: boolean) {
    if (this.transition && animate && this.target && equal(bounds, this.target)) return;
    const from = this.visualBounds();
    const active = !!this.transition;
    this.dispose();
    this.target = bounds;
    if (!animate || equal(from, bounds)) {
      this.transition = null;
      if (!equal(this.window.getBounds(), bounds)) this.window.setBounds(bounds);
      if (active) this.changed(false);
      return;
    }
    const current = this.window.getBounds();
    const x = Math.floor(Math.min(current.x, bounds.x));
    const y = Math.floor(Math.min(current.y, bounds.y));
    const envelope = {
      x,
      y,
      width: Math.ceil(Math.max(current.x + current.width, bounds.x + bounds.width) - x),
      height: Math.ceil(Math.max(current.y + current.height, bounds.y + bounds.height) - y),
    };
    const relative = (b: Rectangle) => ({ ...b, x: b.x - x, y: b.y - y });
    this.from = from;
    this.started = this.clock.now();
    this.transition = {
      id: ++this.sequence,
      duration: 220,
      width: envelope.width,
      height: envelope.height,
      from: relative(from),
      to: relative(bounds),
    };
    if (!equal(current, envelope)) this.window.setBounds(envelope);
    const id = this.transition.id;
    // Renderer completion is primary. Bound the transparent reserve if a renderer stalls.
    this.cancel = this.clock.later(() => this.complete(id), 500);
    this.changed(true);
  }
  complete(id: number) {
    if (this.transition?.id === id) this.finish();
  }
  finish() {
    if (!this.transition) return;
    this.dispose();
    this.transition = null;
    if (this.target && !this.window.isDestroyed() && !equal(this.window.getBounds(), this.target))
      this.window.setBounds(this.target);
    this.changed(false);
  }
  dispose() {
    this.cancel?.();
    this.cancel = null;
  }
}
