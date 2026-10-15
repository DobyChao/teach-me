const test = require('node:test');
const assert = require('node:assert/strict');
const { createGesture, classifyDuration, resolveHold, acceleratorVks, HOLD_MS } = require('../lib/gesture');

test('a short press is text and a hold is voice', () => {
  assert.equal(classifyDuration(HOLD_MS - 1), 'text');
  assert.equal(classifyDuration(HOLD_MS), 'voice');
  const g = createGesture();
  g.down(0);
  assert.equal(g.up(100).became, 'text');
  g.down(0);
  assert.equal(g.tick(HOLD_MS).became, 'voice');
  assert.equal(g.up(HOLD_MS + 400).release, true);
});

test('hold detection treats an unknown key-up as a click', async () => {
  const unknown = await resolveHold(async () => null, { sleep: async () => {} });
  assert.equal(unknown.held, false);
  assert.equal(unknown.unknown, true);

  let n = 0;
  const released = await resolveHold(
    async () => {
      n += 1;
      return n < 2;
    },
    { holdMs: 500, pollMs: 1, sleep: async () => {}, now: (() => { let t = 0; return () => (t += 10); })() },
  );
  assert.equal(released.held, false);
});

test('Ctrl+Alt+W maps to virtual keys', () => {
  assert.deepEqual(acceleratorVks('Control+Alt+W'), [0x11, 0x12, 0x57]);
  assert.equal(acceleratorVks(''), null);
  assert.equal(acceleratorVks('Control+Alt+Space'), null);
});
