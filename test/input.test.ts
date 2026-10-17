import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputController } from '../src/core/input.ts';
import type { Shot } from '../src/shared/protocol.ts';

const shot: Shot = {
  id: 's1',
  path: 'screen.png',
  width: 1000,
  height: 800,
  displayId: 1,
  bounds: { x: 0, y: 0, width: 1000, height: 800 },
  scaleFactor: 1,
  at: 0,
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup(capture: () => Promise<Shot | null> = async () => shot) {
  const events: string[] = [];
  const messages: { text: string; shots: Shot[]; id: string }[] = [];
  const ports = {
    remember: async () => {
      events.push('remember');
      return '123';
    },
    capture: async () => {
      events.push('capture');
      return capture();
    },
    focus: async () => {
      events.push('focus');
    },
    restore: async (h: string | null) => {
      events.push(`restore:${h}`);
    },
    deliver: async (text: string, shots: Shot[], id: string) => {
      messages.push({ text, shots, id });
    },
    changed: () => {},
  };
  return { events, messages, ports, input: new InputController(ports) };
}
test('prepare remembers foreground and captures before focusing', async () => {
  const { input, events } = setup();
  const id = await input.prepare();
  assert.deepEqual(events, ['remember', 'capture', 'focus']);
  assert.equal(input.state.turnId, id);
  assert.equal(input.state.phase, 'editing');
});
test('cancel during capture prevents late focus and next turn contamination', async () => {
  const d = deferred<Shot>();
  const { input, events, messages } = setup(() => d.promise);
  const pending = input.prepare();
  await new Promise((r) => setImmediate(r));
  await input.cancel();
  d.resolve(shot);
  await assert.rejects(pending, /取消/);
  assert.equal(events.includes('focus'), false);
  assert.equal(input.state.phase, 'idle');
  assert.equal(messages.length, 0);
});
test('submit uses prepared frame and restores original window', async () => {
  const { input, messages, events } = setup();
  const id = await input.prepare();
  await input.submit(id, '怎么做', false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].shots[0].id, 's1');
  assert.equal(events.at(-1), 'restore:123');
  assert.equal(input.state.phase, 'idle');
  await assert.rejects(input.submit(id, '重复提交', false));
  assert.equal(messages.length, 1);
});
test('delivery failure keeps transaction retryable', async () => {
  const { input, ports } = setup();
  let attempts = 0;
  ports.deliver = async () => {
    if (++attempts === 1) throw new Error('磁盘错误');
  };
  const id = await input.prepare();
  await assert.rejects(input.submit(id, '保留草稿', false), /磁盘/);
  assert.equal(input.state.phase, 'editing');
  assert.equal(input.state.turnId, id);
  await input.submit(id, '保留草稿', false);
  assert.equal(attempts, 2);
});
test('capture failure does not silently send text without screenshot', async () => {
  const { input, events } = setup(async () => {
    throw new Error('无法截屏');
  });
  await assert.rejects(input.prepare(), /无法截屏/);
  assert.equal(input.state.phase, 'failed');
  assert.equal(events.includes('focus'), false);
});
test('submitting while preparation is pending is rejected', async () => {
  const d = deferred<Shot>();
  const { input } = setup(() => d.promise);
  const pending = input.prepare();
  await assert.rejects(input.submit(input.state.turnId!, '过早发送', false));
  d.resolve(shot);
  await pending;
});
