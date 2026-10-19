import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserWindow, Rectangle } from 'electron';
import { PanelMotion } from '../src/host/panel-motion.ts';

function fixture() {
  let time = 0;
  let bounds: Rectangle = { x: 400, y: 400, width: 120, height: 48 };
  const ticks = new Set<() => void>();
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
  const motion = new PanelMotion(window, (value) => changes.push(value), {
    now: () => time,
    every: (tick) => {
      ticks.add(tick);
      return () => {
        ticks.delete(tick);
      };
    },
  });
  return {
    motion,
    frames,
    changes,
    bounds: () => ({ ...bounds }),
    advance: (ms: number) => {
      time += ms;
      for (const tick of [...ticks]) tick();
    },
  };
}
test('mode morph and measured height retarget from the current frame without a jump or idle gap', () => {
  const f = fixture();
  f.motion.move({ x: 0, y: 0, width: 520, height: 420 }, true);
  f.advance(80);
  const middle = f.bounds();
  assert.ok(middle.width > 120 && middle.width < 520);
  const target = { x: 0, y: 150, width: 520, height: 270 };
  f.motion.move(target, true);
  assert.deepEqual(f.bounds(), middle, 'retarget does not jump to either target');
  assert.deepEqual(f.changes, [true]);
  f.advance(16);
  assert.ok(
    f.bounds().height >= Math.min(middle.height, 270) &&
      f.bounds().height <= Math.max(middle.height, 270),
  );
  assert.notEqual(f.bounds().height, middle.height);
  f.advance(280);
  assert.deepEqual(f.bounds(), target);
  assert.deepEqual(f.changes, [true, false]);
});
test('duplicate measurements do not restart motion; reduced motion and finish apply immediately', () => {
  const f = fixture();
  const target = { x: 0, y: 0, width: 360, height: 76 };
  f.motion.move(target, true);
  f.advance(120);
  f.motion.move(target, true);
  f.advance(160);
  assert.deepEqual(f.bounds(), target);
  assert.deepEqual(f.changes, [true, false]);
  f.motion.move({ ...target, width: 520, height: 400 }, true);
  f.advance(32);
  f.motion.move(target, false);
  assert.deepEqual(f.bounds(), target);
  f.advance(600);
  assert.deepEqual(f.bounds(), target);
  f.motion.move({ ...target, height: 220 }, true);
  f.motion.finish();
  assert.equal(f.bounds().height, 220);
  assert.deepEqual(f.changes, [true, false, true, false, true, false]);
});
