import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserWindow, Rectangle } from 'electron';
import { PanelMotion } from '../src/host/panel-motion.ts';
function fixture() {
  let time = 0;
  let bounds: Rectangle = { x: 400, y: 400, width: 120, height: 48 };
  const timers = new Map<() => void, number>();
  const frames: Rectangle[] = [];
  const changes: boolean[] = [];
  const window = {
    getBounds: () => ({ ...bounds }),
    isDestroyed: () => false,
    setBounds: (b: Rectangle) => {
      bounds = { ...b };
      frames.push({ ...b });
    },
  } as unknown as BrowserWindow;
  const motion = new PanelMotion(window, (v) => changes.push(v), {
    now: () => time,
    later: (fn, ms) => {
      timers.set(fn, time + ms);
      return () => {
        timers.delete(fn);
      };
    },
  });
  return {
    motion,
    frames,
    changes,
    bounds: () => bounds,
    advance: (ms: number) => {
      time += ms;
      for (const [fn, at] of [...timers])
        if (at <= time) {
          timers.delete(fn);
          fn();
        }
    },
  };
}
test('compositor transition allocates once, does not resize per frame, and releases on completion', () => {
  const f = fixture();
  const target = { x: 160, y: 372, width: 360, height: 76 };
  f.motion.move(target, true);
  const id = f.motion.transition!.id;
  assert.equal(f.frames.length, 1);
  assert.deepEqual(f.motion.transition!.from, { x: 240, y: 28, width: 120, height: 48 });
  for (let i = 0; i < 14; i++) f.advance(16);
  assert.equal(f.frames.length, 1, 'native bounds are not written at animation frame frequency');
  f.motion.complete(id);
  assert.deepEqual(f.bounds(), target);
  assert.equal(f.motion.transition, null);
  assert.deepEqual(f.changes, [true, false]);
});
test('retarget uses current visual frame; duplicate and stale completion do not interrupt the new target', () => {
  const f = fixture();
  f.motion.move({ x: 0, y: 0, width: 520, height: 420 }, true);
  const old = f.motion.transition!.id;
  f.advance(80);
  const target = { x: 0, y: 150, width: 520, height: 270 };
  f.motion.move(target, true);
  const current = f.motion.transition!;
  assert.ok(current.from.width > 120 && current.from.width < 520);
  f.motion.complete(old);
  assert.equal(f.motion.transition!.id, current.id);
  f.motion.move(target, true);
  assert.equal(f.motion.transition!.id, current.id);
  f.motion.complete(current.id);
  assert.deepEqual(f.bounds(), target);
});
test('reduced motion applies immediately and missing renderer completion has a bounded fallback', () => {
  const f = fixture();
  const target = { x: 0, y: 0, width: 360, height: 76 };
  f.motion.move(target, true);
  f.advance(80);
  f.motion.move(target, false);
  assert.deepEqual(f.bounds(), target);
  assert.equal(f.motion.transition, null);
  f.advance(600);
  assert.deepEqual(f.bounds(), target);
  f.motion.move({ ...target, height: 400 }, true);
  f.advance(501);
  assert.equal(f.bounds().height, 400);
  assert.equal(f.motion.transition, null);
  assert.deepEqual(f.changes, [true, false, true, false]);
});
