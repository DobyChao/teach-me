import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputController } from '../src/core/input.ts';
import { Session } from '../src/core/session.ts';
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
test('focus failure after delivery cannot reopen a sent turn or swallow the next message', async () => {
  const { input, ports } = setup();
  const session = new Session('delivery boundary');
  ports.deliver = async (text, shots, id) => {
    session.push(text, shots, id);
  };
  ports.restore = async () => {
    throw new Error('native focus unavailable');
  };
  const first = await input.prepare();
  await input.submit(first, 'first message', false);
  assert.equal(input.state.phase, 'idle');
  assert.equal(input.state.turnId, null);
  assert.match(input.state.error!, /已发送.*焦点/);
  await assert.rejects(input.submit(first, 'edited retry', false), /失效/);
  const next = await input.prepare();
  assert.notEqual(next, first);
  assert.equal(input.state.error, null);
  await input.submit(next, 'next message', false);
  assert.deepEqual(
    session.pending.map((m) => [m.text, m.shots[0]?.id]),
    [
      ['first message', 's1'],
      ['next message', 's1'],
    ],
  );
});
test('late post-delivery focus failure does not overwrite a newer editing turn', async () => {
  const { input, ports } = setup();
  const restore = deferred<void>();
  ports.restore = async () => {
    await restore.promise;
    throw new Error('late native failure');
  };
  const first = await input.prepare();
  const sending = input.submit(first, 'sent', false);
  await new Promise((r) => setImmediate(r));
  const next = await input.prepare();
  restore.resolve();
  await sending;
  assert.equal(input.state.turnId, next);
  assert.equal(input.state.phase, 'editing');
  assert.equal(input.state.error, null);
});
test('failed delivery retries the same turn with its original screenshot', async () => {
  const { input, ports } = setup();
  const attempts: { id: string; shots: Shot[] }[] = [];
  ports.deliver = async (_text, shots, id) => {
    attempts.push({ id, shots });
    if (attempts.length === 1) throw new Error('attachment unavailable');
  };
  const id = await input.prepare();
  await assert.rejects(input.submit(id, 'keep draft', false), /attachment/);
  assert.equal(input.state.phase, 'editing');
  await input.submit(id, 'keep draft', false);
  assert.deepEqual(attempts, [
    { id, shots: [shot] },
    { id, shots: [shot] },
  ]);
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

test('overlapping hotkey and pointer preparation share capture, turn and focus', async () => {
  const d = deferred<Shot>();
  const { input, events } = setup(() => d.promise);
  const first = input.prepare(false);
  const second = input.prepare();
  const third = input.prepare();
  d.resolve(shot);
  const ids = await Promise.all([first, second, third]);
  assert.equal(new Set(ids).size, 1);
  assert.deepEqual(events, ['remember', 'capture', 'focus']);
  assert.equal(await input.prepare(), ids[0]);
  assert.deepEqual(events, ['remember', 'capture', 'focus', 'focus']);
});

test('canceled preparation cannot clear the next in-flight preparation', async () => {
  const old = deferred<Shot>();
  const next = deferred<Shot>();
  let calls = 0;
  const { input } = setup(() => (++calls === 1 ? old.promise : next.promise));
  const first = input.prepare();
  await new Promise((r) => setImmediate(r));
  await input.cancel();
  const second = input.prepare();
  old.resolve(shot);
  await assert.rejects(first, /取消/);
  const joined = input.prepare();
  next.resolve(shot);
  assert.equal(await second, await joined);
  assert.equal(calls, 2);
});
