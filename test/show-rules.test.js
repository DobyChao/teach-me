const test = require('node:test');
const assert = require('node:assert/strict');
const { expandScene } = require('../lib/patterns');
const { assertSay, singleScene } = require('../lib/show-rules');
const { resolveScene } = require('../app/scene');

const display = { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 2 };
const shots = {
  get() {
    return {
      id: 's1',
      display: { id: 1, bounds: { ...display.bounds }, scaleFactor: 2 },
      dipRect: { x: 0, y: 0, width: 1000, height: 800 },
      width: 2000,
      height: 1600,
    };
  },
};

test('patterns expand into primitives and show must include say', () => {
  const { scene, warnings } = expandScene({
    say: '点这里',
    pattern: 'point',
    to: [10, 20],
    label: '文件',
  });
  assert.equal(warnings.length, 0);
  assert.equal(scene.items[0].type, 'arrow');
  assert.doesNotThrow(() => assertSay(scene));
  assert.throws(() => assertSay({ items: [] }), /say/);
  assert.equal(singleScene({ keep: true }).replace, true);
  assert.match(singleScene({ keep: true }).warnings[0], /one scene/);
});

test('custom html is text-only, clamped, and sandboxed', () => {
  const huge = {
    say: '看这个',
    items: [
      { type: 'html', rect: [0, 0, 900, 700], html: '<i>动画</i>' },
      { type: 'html', file: '/tmp/anim.html', rect: [40, 40, 100, 80] },
    ],
  };
  const { items, warnings } = resolveScene(huge, { shots, defaultShot: 's1', displays: [display], primary: display });
  assert.equal(items.length, 1);
  assert.equal(items[0].sandbox, 'allow-scripts');
  assert.doesNotMatch(items[0].sandbox, /allow-same-origin/);
  assert.match(items[0].srcdoc, /default-src 'none'/);
  assert.ok(items[0].rect[2] < 1000);
  assert.equal(items[0].opacity >= 0.85, true);
  assert.ok(items[0].ttl <= 60000);
  assert.ok(warnings.some((w) => /file/i.test(w)));
  assert.equal(items[0].hash.length, 64);
});

test('a basic primitive still maps shot pixels through the recorded geometry', () => {
  const { items } = resolveScene(
    { say: '这里', items: [{ type: 'arrow', to: [1000, 800] }] },
    { shots, defaultShot: 's1', displays: [display], primary: display },
  );
  assert.equal(items.length, 1);
  assert.ok(Math.abs(items[0].to[0] - 500) < 0.01);
  assert.ok(Math.abs(items[0].to[1] - 400) < 0.01);
});
