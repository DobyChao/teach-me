import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { transcribe } from '../src/host/speech.ts';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kills = 0;
  kill() {
    this.kills++;
    return true;
  }
}
type Result = { ok: true; value: string } | { ok: false; error: unknown };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function settled(promise: Promise<Result>) {
  const result = await Promise.race([promise, turn().then(() => null)]);
  assert.notEqual(result, null, 'operation should settle at this lifecycle boundary');
  return result!;
}
function rejected(result: Result, reason?: unknown) {
  assert.equal(result.ok, false);
  if (!result.ok && reason !== undefined) assert.equal(result.error, reason);
}
function setup(t: TestContext) {
  const files = new Map<string, Uint8Array>();
  const children: { child: FakeChild; file: string }[] = [];
  const pending: Promise<Result>[] = [];
  const controllers: AbortController[] = [];
  const releases: (() => void)[] = [];
  let writes = 0;
  let directories = 0;
  let requests = 0;
  let writeGate = Promise.resolve();
  let fetcher: typeof fetch = async () => {
    throw new Error('unexpected fake fetch');
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(fs, 'mkdir', async () => {
    directories++;
  });
  t.mock.method(fs, 'writeFile', async (...args: unknown[]) => {
    writes++;
    files.set(String(args[0]), new Uint8Array(args[1] as Uint8Array));
    await writeGate;
  });
  t.mock.method(fs, 'rm', async (...args: unknown[]) => {
    files.delete(String(args[0]));
  });
  t.mock.method(childProcess, 'spawn', (...args: unknown[]) => {
    const child = new FakeChild();
    children.push({ child, file: (args[1] as string[])[0] });
    return child;
  });
  syncBuiltinESMExports();
  t.mock.method(globalThis, 'fetch', (...args: Parameters<typeof fetch>) => {
    requests++;
    return fetcher(...args);
  });
  // Node's built-in timeout uses internal timers; provide a controllable equivalent.
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
  const controller = () => {
    const value = new AbortController();
    controllers.push(value);
    return value;
  };
  const run = (signal?: AbortSignal, engine = 'local') => {
    const promise: Promise<Result> = transcribe(
      new Uint8Array([1, 2, 3]),
      'audio/webm',
      { engine, localCommand: 'fake-recognizer', customUrl: 'https://fixture.invalid/asr' },
      '.runtime/fake-transcription-only',
      signal,
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    pending.push(promise);
    return promise;
  };
  t.after(async () => {
    for (const value of controllers) value.abort();
    for (const release of releases) release();
    await turn();
    for (const { child } of children) child.emit('close', 1);
    t.mock.timers.tick(25000);
    await Promise.all(pending.map((promise) => Promise.race([promise, turn()])));
    t.mock.timers.reset();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return {
    files,
    children,
    controller,
    run,
    effects: () => ({ writes, directories, requests, children: children.length }),
    fetch: (value: typeof fetch) => (fetcher = value),
    holdWrite: () => {
      let release!: () => void;
      writeGate = new Promise<void>((resolve) => (release = resolve));
      releases.push(release);
      return release;
    },
  };
}
const aborted = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

test('local success returns this child output and removes its audio after close', async (t) => {
  const h = setup(t);
  const pending = h.run();
  await turn();
  assert.equal(h.children.length, 1);
  const { child, file } = h.children[0];
  assert.ok(h.files.has(file));
  child.stdout.emit('data', Buffer.from('recognition '));
  child.stdout.emit('data', Buffer.from('result\n'));
  child.emit('close', 0);
  assert.deepEqual(await settled(pending), { ok: true, value: 'recognition result' });
  assert.equal(h.files.size, 0);
});

test('pre-canceled local and custom requests have no filesystem, process or network effects', async (t) => {
  const h = setup(t);
  const controller = h.controller();
  const reason = new Error('already canceled');
  controller.abort(reason);
  for (const engine of ['local', 'custom']) {
    const pending = h.run(controller.signal, engine);
    await turn();
    assert.deepEqual(h.effects(), { writes: 0, directories: 0, requests: 0, children: 0 });
    rejected(await settled(pending), reason);
  }
});

test('cancel during audio write waits for that write then removes it without spawning', async (t) => {
  const h = setup(t);
  const release = h.holdWrite();
  const controller = h.controller();
  const pending = h.run(controller.signal);
  await turn();
  assert.equal(h.files.size, 1);
  const reason = new Error('canceled during write');
  controller.abort(reason);
  await turn();
  assert.equal(h.files.size, 1, 'do not race deletion against an unfinished write');
  release();
  await turn();
  assert.equal(h.children.length, 0);
  rejected(await settled(pending), reason);
  assert.equal(h.files.size, 0);
});

test('running local cancellation kills its child and waits for close before deleting audio', async (t) => {
  const h = setup(t);
  const controller = h.controller();
  const pending = h.run(controller.signal);
  await turn();
  const { child, file } = h.children[0];
  const reason = new Error('user canceled');
  controller.abort(reason);
  await turn();
  assert.ok(child.kills > 0);
  assert.ok(h.files.has(file), 'audio is retained until the process closes');
  child.emit('close', 0);
  rejected(await settled(pending), reason);
  assert.equal(h.files.size, 0);
});

test('late callbacks from a canceled transcription cannot kill or clean a newer one', async (t) => {
  const h = setup(t);
  const controller = h.controller();
  const old = h.run(controller.signal);
  await turn();
  const previous = h.children[0];
  const reason = new Error('old cancellation');
  controller.abort(reason);
  const next = h.run();
  await turn();
  const current = h.children[1];
  assert.notEqual(previous.file, current.file);
  previous.child.emit('close', 1);
  rejected(await settled(old), reason);
  previous.child.stdout.emit('data', Buffer.alloc(128 * 1024 + 1));
  previous.child.emit('close', 0);
  assert.equal(current.child.kills, 0);
  assert.ok(h.files.has(current.file));
  assert.equal(h.files.has(previous.file), false);
  current.child.stdout.emit('data', Buffer.from('fresh'));
  current.child.emit('close', 0);
  assert.deepEqual(await settled(next), { ok: true, value: 'fresh' });
  assert.equal(h.files.size, 0);
});

test('canceled child missing close has a bounded five-second cleanup wait', async (t) => {
  const h = setup(t);
  const controller = h.controller();
  const pending = h.run(controller.signal);
  await turn();
  const reason = new Error('canceled without close');
  controller.abort(reason);
  t.mock.timers.tick(4999);
  await turn();
  assert.equal(h.files.size, 1);
  t.mock.timers.tick(1);
  rejected(await settled(pending), reason);
  assert.equal(h.files.size, 0);
});

for (const mode of ['error', 'throw']) {
  test(`a kill ${mode} does not imply close or replace the original cancellation`, async (t) => {
    const h = setup(t);
    const controller = h.controller();
    const pending = h.run(controller.signal);
    await turn();
    const { child, file } = h.children[0];
    t.mock.method(child, 'kill', () => {
      if (mode === 'throw') throw new Error('fixture kill failed');
      queueMicrotask(() => child.emit('error', new Error('fixture kill failed')));
      return false;
    });
    const reason = new Error('original cancellation');
    controller.abort(reason);
    await turn();
    assert.ok(h.files.has(file), 'a failed kill is not evidence that the audio file was released');
    child.emit('close', 1);
    rejected(await settled(pending), reason);
    assert.equal(h.files.size, 0);
  });
}

for (const fault of ['deadline', 'output-limit']) {
  test(`local ${fault} retains its failure when cancellation follows`, async (t) => {
    const h = setup(t);
    const controller = h.controller();
    const pending = h.run(controller.signal);
    await turn();
    const { child, file } = h.children[0];
    if (fault === 'deadline') t.mock.timers.tick(20000);
    else child.stdout.emit('data', Buffer.alloc(128 * 1024 + 1));
    controller.abort(new Error('later cancellation'));
    await turn();
    assert.ok(child.kills > 0);
    assert.ok(h.files.has(file), 'failed running process still owns the file until close');
    child.emit('close', 0);
    const result = await settled(pending);
    rejected(result);
    if (!result.ok) assert.match(String(result.error), fault === 'deadline' ? /超时/ : /过大/);
    assert.equal(h.files.size, 0);
  });
}

test('cancellation stays the failure when later output and timeout arrive', async (t) => {
  const h = setup(t);
  const controller = h.controller();
  const pending = h.run(controller.signal);
  await turn();
  const { child } = h.children[0];
  const reason = new Error('first cancellation');
  controller.abort(reason);
  child.stdout.emit('data', Buffer.alloc(128 * 1024 + 1));
  t.mock.timers.tick(20000);
  rejected(await settled(pending), reason);
  assert.equal(h.files.size, 0);
});

test('custom success reads the transcript with no local audio or process', async (t) => {
  const h = setup(t);
  h.fetch(async (_url, options) => {
    assert.ok(options?.signal);
    assert.deepEqual([...new Uint8Array(options.body as ArrayBuffer)], [1, 2, 3]);
    return { ok: true, json: async () => ({ transcript: 'custom result' }) } as Response;
  });
  assert.deepEqual(await settled(h.run(undefined, 'custom')), { ok: true, value: 'custom result' });
  assert.deepEqual(h.effects(), { writes: 0, directories: 0, requests: 1, children: 0 });
});

for (const phase of ['fetch', 'body']) {
  for (const cause of ['cancel', 'deadline']) {
    test(`custom ${cause} aborts a pending ${phase}`, async (t) => {
      const h = setup(t);
      const controller = h.controller();
      let requestSignal: AbortSignal | undefined;
      let bodyEntered = false;
      h.fetch(async (_url, options) => {
        requestSignal = options?.signal as AbortSignal;
        assert.ok(requestSignal);
        if (phase === 'fetch') return aborted(requestSignal);
        return Object.assign(new Response(), {
          json: async () => {
            bodyEntered = true;
            return aborted(requestSignal!);
          },
        });
      });
      const pending = h.run(controller.signal, 'custom');
      await turn();
      if (phase === 'body') assert.equal(bodyEntered, true);
      const reason = new Error('custom canceled');
      if (cause === 'cancel') controller.abort(reason);
      else t.mock.timers.tick(20000);
      assert.equal(requestSignal?.aborted, true);
      rejected(await settled(pending), cause === 'cancel' ? reason : undefined);
      assert.equal(h.files.size, 0);
      assert.equal(h.children.length, 0);
    });
  }
}
