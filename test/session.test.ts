import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/core/session.ts';
test('unacknowledged messages redeliver; ack removes only delivered messages', async () => {
  const s = new Session('教学');
  const message = s.push('好了', [], 'u1');
  assert.throws(() => s.ack(message.id));
  assert.equal((await s.wait(100))[0].id, message.id);
  assert.equal((await s.wait(100))[0].id, message.id);
  s.ack(message.id);
  assert.equal(s.pending.length, 0);
});
test('client submission ID prevents duplicate delivery', () => {
  const s = new Session('教学');
  const first = s.push('好了', [], 'u1');
  assert.equal(s.push('好了', [], 'u1'), first);
  assert.equal(s.messages.length, 1);
});
test('one waiter only; user response resolves waiter as thinking', async () => {
  const s = new Session('教学');
  const pending = s.wait(1000);
  assert.equal(s.phase, 'waiting');
  await assert.rejects(s.wait(1000), /已有 wait/);
  s.push('下一步', [], 'u1');
  assert.equal((await pending).length, 1);
  assert.equal(s.phase, 'thinking');
});
test('aborted wait keeps pending user messages', async () => {
  const s = new Session('教学');
  const controller = new AbortController();
  const pending = s.wait(1000, controller.signal);
  controller.abort();
  await assert.rejects(pending, /aborted/);
  s.push('不丢失', [], 'u1');
  assert.equal((await s.wait(100))[0].text, '不丢失');
});
test('ending wakes waiter and prevents more delivery', async () => {
  const s = new Session('教学');
  const pending = s.wait(1000);
  s.end();
  assert.deepEqual(await pending, []);
  assert.equal(s.phase, 'ended');
  assert.throws(() => s.push('late', [], 'u1'));
});

test('idle agent expires after grace; reconnect preserves queued messages', async () => {
  let now = 0;
  const s = new Session(
    '教学',
    () => {},
    () => now,
  );
  await s.wait(1);
  now = 14_999;
  s.refreshConnection();
  assert.equal(s.phase, 'ready');
  now = 15_000;
  s.refreshConnection();
  assert.equal(s.phase, 'offline');
  s.push('请回复', [], 'u1');
  assert.equal(s.phase, 'offline');
  assert.equal((await s.wait(100))[0].text, '请回复');
  assert.equal(s.phase, 'thinking');
  now += 299_999;
  s.refreshConnection();
  assert.equal(s.phase, 'thinking');
  now++;
  s.refreshConnection();
  assert.equal(s.phase, 'offline');
  s.say('已恢复');
  assert.equal(s.phase, 'ready');
});

test('active long poll does not expire and end never changes to offline', async () => {
  let now = 0;
  const s = new Session(
    '教学',
    () => {},
    () => now,
  );
  const pending = s.wait(1000);
  now = 600_000;
  s.refreshConnection();
  assert.equal(s.phase, 'waiting');
  s.end();
  await pending;
  s.refreshConnection();
  assert.equal(s.phase, 'ended');
});
