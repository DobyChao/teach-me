const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beginCapture,
  hotkeyOnCapture,
  interruptCountdown,
  applyCaptureDecision,
  lightweightContext,
  withoutCaptureContext,
  withRetries,
  MAX_ATTEMPTS,
} = require('../lib/capture-policy');

test('ask shows a pending bubble with no countdown', () => {
  const s = beginCapture('ask');
  assert.equal(s.phase, 'pending');
  assert.equal(s.countdownMs, 0);
});

test('lesson allow counts down, and the hotkey returns it to pending', () => {
  const s = beginCapture('lesson');
  assert.equal(s.phase, 'countdown');
  assert.ok(s.countdownMs > 0);
  assert.equal(hotkeyOnCapture('countdown'), 'interrupt');
  const back = interruptCountdown(s);
  assert.equal(back.phase, 'pending');
  assert.equal(back.interrupted, true);
  assert.equal(hotkeyOnCapture('pending'), 'allow');
});

test('always allow skips the bubble', () => {
  assert.equal(beginCapture('always').phase, 'approved');
  assert.equal(beginCapture('nope').phase, 'pending');
});

test('countdown finishing approves; deny stays deny', () => {
  const s = beginCapture('lesson');
  assert.equal(applyCaptureDecision(s, 'timeout').phase, 'approved');
  assert.equal(applyCaptureDecision(s, 'deny').phase, 'denied');
});

test('lightweight context omits the window title unless asked', () => {
  const raw = {
    focusedProcess: 'Code.exe',
    mouse: { x: 3, y: 4 },
    foregroundBounds: { x: 1, y: 2, width: 30, height: 40 },
    windowTitle: 'Secret.doc — Editor',
  };
  const plain = lightweightContext(raw, { includeTitle: false });
  assert.equal(plain.focusedProcess, 'Code.exe');
  assert.deepEqual(plain.mouse, { x: 3, y: 4 });
  assert.equal(plain.foregroundBounds.width, 30);
  assert.equal('windowTitle' in plain, false);
  const titled = lightweightContext(raw, { includeTitle: true });
  assert.equal(titled.windowTitle, 'Secret.doc — Editor');
});

test('wait results drop capture context but keep the user message', () => {
  const waited = withoutCaptureContext({
    messages: [{ id: 1, text: '继续', context: { focusedProcess: 'x' }, windowTitle: 'nope', shots: [{ id: 's1' }] }],
    context: { mouse: { x: 1, y: 1 } },
    focusedProcess: 'x',
    defaultShot: 's1',
  });
  assert.equal('context' in waited, false);
  assert.equal('focusedProcess' in waited, false);
  assert.equal(waited.defaultShot, 's1');
  assert.equal(waited.messages[0].text, '继续');
  assert.equal(waited.messages[0].shots[0].id, 's1');
  assert.equal('context' in waited.messages[0], false);
  assert.equal('windowTitle' in waited.messages[0], false);
});

test('capture retries are finite', async () => {
  let n = 0;
  const ok = await withRetries(
    async () => {
      n += 1;
      if (n < MAX_ATTEMPTS) throw new Error('again');
      return 'frame';
    },
    { delayMs: 0 },
  );
  assert.equal(ok.value, 'frame');
  assert.equal(ok.attempts, MAX_ATTEMPTS);

  await assert.rejects(
    () => withRetries(async () => { throw new Error('nope'); }, { attempts: MAX_ATTEMPTS, delayMs: 0 }),
    (err) => err.attempts === MAX_ATTEMPTS && /nope/.test(err.message),
  );
});
