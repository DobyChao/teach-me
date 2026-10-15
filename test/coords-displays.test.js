const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutChanged, shotPixelToDip, STALE_PROMPT } = require('../lib/coords');
const { inspectDisplay, selectableDisplays } = require('../lib/displays');

test('screenshot pixels map with the geometry recorded at capture time', () => {
  const shot = {
    width: 200,
    height: 100,
    dipRect: { x: 1000, y: 200, width: 400, height: 200 },
  };
  assert.deepEqual(shotPixelToDip(shot, 100, 50), { x: 1200, y: 300 });
});

test('a scale or bounds change is stale and asks for a new shot', () => {
  const recorded = { scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  assert.equal(layoutChanged(recorded, { scaleFactor: 1.5, bounds: { ...recorded.bounds } }), false);
  assert.equal(layoutChanged(recorded, { scaleFactor: 2, bounds: { ...recorded.bounds } }), true);
  assert.equal(layoutChanged(recorded, { scaleFactor: 1.5, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }), true);
  assert.match(STALE_PROMPT, /重新截/);
});

test('virtual displays are normal when capture and scale work, otherwise unsupported', () => {
  const virtual = { id: 7, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, scaleFactor: 1.25, internal: false, virtual: true };
  const ok = inspectDisplay(virtual, { captureOk: true });
  assert.equal(ok.supported, true);
  assert.equal(ok.label, '');
  const blind = inspectDisplay(virtual, { captureOk: false });
  assert.equal(blind.supported, false);
  assert.equal(blind.reason, 'no-capture');
  assert.equal(blind.label, '不支持');
  const unscaled = inspectDisplay({ id: 8, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 0 }, { captureOk: true });
  assert.equal(unscaled.reason, 'no-scale');
  assert.deepEqual(selectableDisplays([ok, blind]).map((d) => d.id), [7]);
});
