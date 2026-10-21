import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { SystemSpeech } from '../src/host/speech.ts';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  writes: string[] = [];
  kills = 0;
  stdin = Object.assign(new EventEmitter(), {
    write: (line: string) => {
      this.writes.push(line);
      return true;
    },
  });
  kill() {
    // Killing a process does not synchronously emit its eventual exit.
    this.kills++;
    return true;
  }
  data(value: string) {
    this.stdout.emit('data', Buffer.from(value));
  }
  text(value: string) {
    this.data(`TEXT:${Buffer.from(value).toString('base64')}\n`);
  }
}

function setup(t: TestContext) {
  const children: FakeChild[] = [];
  t.mock.method(childProcess, 'spawn', () => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const speech = new SystemSpeech();
  t.after(() => {
    speech.abort();
    for (const child of children) child.emit('exit', 1);
    t.mock.timers.reset();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { speech, children };
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const outcome = <T>(promise: Promise<T>): Promise<Outcome<T>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
async function settled<T>(promise: Promise<Outcome<T>>) {
  const result = await Promise.race([
    promise,
    new Promise<null>((resolve) => setImmediate(() => resolve(null))),
  ]);
  assert.notEqual(result, null, 'operation must settle without waiting for a late child exit');
  return result!;
}

test('system speech reads split READY and transcript lines and stops normally', async (t) => {
  const { speech, children } = setup(t);
  const live: string[] = [];
  const starting = outcome(speech.start((text) => live.push(text)));
  const child = children[0];
  child.data('REA');
  child.data('DY\r\nTE');
  assert.equal((await settled(starting)).ok, true);
  child.data(`XT:${Buffer.from('你').toString('base64')}\nTEXT:`);
  child.data(`${Buffer.from('好').toString('base64')}\n`);
  assert.deepEqual(live, ['你', '你好']);
  const stopping = outcome(speech.stop());
  assert.deepEqual(child.writes, ['stop\n']);
  child.emit('exit', 0);
  assert.deepEqual(await settled(stopping), { ok: true, value: '你好' });
});

test('late old stop cannot kill a replacement or return its transcript', async (t) => {
  const { speech, children } = setup(t);
  const first = outcome(speech.start(() => {}));
  const old = children[0];
  old.data('READY\n');
  assert.equal((await settled(first)).ok, true);
  old.text('old transcript');
  const stopping = outcome(speech.stop());
  speech.abort();
  const live: string[] = [];
  const next = outcome(speech.start((text) => live.push(text)));
  const current = children[1];
  current.data('READY\n');
  current.text('new transcript');
  assert.equal((await settled(next)).ok, true);
  old.text('late old text');
  old.emit('exit', 0);
  const result = await settled(stopping);
  assert.equal(current.kills, 0, 'old stop must not abort the new recognizer');
  if (result.ok) assert.equal(result.value, 'old transcript');
  assert.deepEqual(live, ['new transcript']);
  const finish = outcome(speech.stop());
  current.emit('exit', 0);
  assert.deepEqual(await settled(finish), { ok: true, value: 'new transcript' });
});

test('old startup deadline cannot kill a ready replacement after cancellation', async (t) => {
  const { speech, children } = setup(t);
  const first = outcome(speech.start(() => {}));
  const old = children[0];
  old.data('REA');
  speech.abort();
  const live: string[] = [];
  const next = outcome(speech.start((text) => live.push(text)));
  const current = children[1];
  current.data('READY\n');
  assert.equal((await settled(next)).ok, true);
  t.mock.timers.tick(8000);
  assert.equal((await settled(first)).ok, false);
  assert.equal(current.kills, 0, 'retired startup timer must not kill the current child');
  old.data('DY\n');
  old.text('stale');
  old.emit('exit', 1);
  current.text('current');
  assert.deepEqual(live, ['current']);
});

test('abort promptly rejects a pending start without requiring child exit', async (t) => {
  const { speech, children } = setup(t);
  const starting = outcome(speech.start(() => {}));
  speech.abort();
  assert.ok(children[0].kills > 0);
  assert.equal((await settled(starting)).ok, false);
});

test('abort promptly settles a pending stop without requiring child exit', async (t) => {
  const { speech, children } = setup(t);
  const starting = outcome(speech.start(() => {}));
  const child = children[0];
  child.data('READY\n');
  assert.equal((await settled(starting)).ok, true);
  child.text('partial');
  const stopping = outcome(speech.stop());
  speech.abort();
  const result = await settled(stopping);
  // Cancellation may reject or return this turn's text; it must not remain pending.
  if (result.ok) assert.equal(result.value, 'partial');
});

test('exit zero before READY rejects startup rather than leaving it pending', async (t) => {
  const { speech, children } = setup(t);
  const starting = outcome(speech.start(() => {}));
  children[0].emit('exit', 0);
  assert.equal((await settled(starting)).ok, false);
});

test('spawn error and recognizer error allow another clean recording', async (t) => {
  const { speech, children } = setup(t);
  const first = outcome(speech.start(() => {}));
  children[0].emit('error', new Error('fixture spawn failure'));
  assert.equal((await settled(first)).ok, false);
  const second = outcome(speech.start(() => {}));
  children[1].data(`ERROR:${Buffer.from('fixture recognizer failure').toString('base64')}\n`);
  assert.equal((await settled(second)).ok, false);
  const live: string[] = [];
  const third = outcome(speech.start((text) => live.push(text)));
  const current = children[2];
  current.data('READY\n');
  assert.equal((await settled(third)).ok, true);
  children[0].emit('exit', 1);
  children[1].text('obsolete');
  children[1].emit('exit', 1);
  current.text('recovered');
  assert.deepEqual(live, ['recovered']);
  assert.equal(current.kills, 0);
  const stopping = outcome(speech.stop());
  current.emit('exit', 0);
  assert.deepEqual(await settled(stopping), { ok: true, value: 'recovered' });
});

test('startup and stop deadlines settle and do not poison later recordings', async (t) => {
  const { speech, children } = setup(t);
  const starting = outcome(speech.start(() => {}));
  const startupChild = children[0];
  t.mock.timers.tick(8000);
  assert.equal((await settled(starting)).ok, false);
  assert.ok(startupChild.kills > 0);
  const next = outcome(speech.start(() => {}));
  const stopChild = children[1];
  stopChild.data('READY\n');
  assert.equal((await settled(next)).ok, true);
  const stopping = outcome(speech.stop());
  t.mock.timers.tick(5000);
  assert.equal((await settled(stopping)).ok, false);
  assert.ok(stopChild.kills > 0);
  const final = outcome(speech.start(() => {}));
  const current = children[2];
  current.data('READY\n');
  assert.equal((await settled(final)).ok, true);
  startupChild.emit('exit', 1);
  stopChild.emit('exit', 0);
  assert.equal(current.kills, 0);
  const finish = outcome(speech.stop());
  current.emit('exit', 0);
  assert.deepEqual(await settled(finish), { ok: true, value: '' });
});

test('a recognizer failure after READY is preserved when the user stops later', async (t) => {
  const { speech, children } = setup(t);
  for (const failure of ['protocol', 'exit', 'process']) {
    const starting = outcome(speech.start(() => {}));
    const child = children.at(-1)!;
    child.data('READY\n');
    assert.equal((await settled(starting)).ok, true);
    if (failure === 'protocol')
      child.data(`ERROR:${Buffer.from('microphone disconnected').toString('base64')}\n`);
    else if (failure === 'exit') child.emit('exit', 1);
    else child.emit('error', new Error('recognizer unavailable'));
    const result = await settled(outcome(speech.stop()));
    assert.equal(result.ok, false, `${failure} must not become an empty successful transcript`);
    if (!result.ok) {
      assert.ok(result.error instanceof Error);
      assert.match(
        result.error.message,
        /microphone disconnected|语音识别不可用|recognizer unavailable/,
      );
    }
  }
});
