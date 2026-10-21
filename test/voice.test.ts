import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../src/core/voice.ts';
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  const events: string[] = [];
  const ports = {
    prepare: async () => {
      events.push('prepare');
    },
    start: async () => {
      events.push('start');
    },
    stop: async (_signal: AbortSignal) => {
      events.push('stop');
      return '识别结果';
    },
    abort: () => {
      events.push('abort');
    },
    submit: async (text: string) => {
      events.push(`submit:${text}`);
    },
    cancel: async () => {
      events.push('cancel');
    },
    changed: () => {},
    confirmMs: () => 1000,
  };
  return { events, ports, voice: new VoiceController(ports) };
}
test('release while preparing does not open microphone late', async () => {
  const { voice, ports, events } = setup();
  const d = deferred<void>();
  ports.prepare = () => d.promise;
  const pending = voice.start();
  await voice.stop();
  d.resolve();
  await pending;
  assert.equal(events.includes('start'), false);
  assert.equal(voice.state.phase, 'idle');
});
test('recognized speech has a revocable review window', async () => {
  const { voice, events } = setup();
  await voice.start();
  await voice.stop();
  assert.equal(voice.state.phase, 'review');
  assert.equal(voice.state.text, '识别结果');
  await voice.cancel();
  assert.equal(
    events.some((e) => e.startsWith('submit:')),
    false,
  );
});
test('late transcription after cancel cannot submit or revive review', async () => {
  const { voice, ports, events } = setup();
  const d = deferred<string>();
  ports.stop = () => d.promise;
  await voice.start();
  const pending = voice.stop();
  await voice.cancel();
  d.resolve('late');
  await pending;
  assert.equal(voice.state.phase, 'idle');
  assert.equal(
    events.some((e) => e.startsWith('submit:')),
    false,
  );
});
test('recognition failure releases resources and permits another turn', async () => {
  const { voice, ports, events } = setup();
  ports.stop = async () => {
    throw new Error('引擎失败');
  };
  await voice.start();
  await voice.stop();
  assert.equal(voice.state.phase, 'idle');
  assert.equal(voice.state.error, '引擎失败');
  assert.ok(events.includes('abort'));
  await voice.start();
  assert.equal(voice.state.phase, 'recording');
  await voice.cancel();
});
test('review deadline submits once and returns idle', async () => {
  const { voice, events } = setup();
  await voice.start();
  await voice.stop();
  await new Promise((r) => setTimeout(r, 1050));
  assert.equal(events.filter((e) => e.startsWith('submit:')).length, 1);
  assert.equal(voice.state.phase, 'idle');
  await voice.cancel();
});

test('a canceled review submission cannot cancel a newer recording when it fails late', async () => {
  const { voice, ports, events } = setup();
  const submitting = deferred<void>();
  const release = deferred<void>();
  ports.submit = async () => {
    submitting.resolve();
    await release.promise;
    throw new Error('old attachment invalidated');
  };
  try {
    await voice.start();
    await voice.stop();
    await submitting.promise;
    await voice.cancel();
    await voice.start();
    const newId = voice.state.id;
    const cancelCount = events.filter((event) => event === 'cancel').length;
    release.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(voice.state.id, newId);
    assert.equal(voice.state.phase, 'recording');
    assert.equal(voice.state.error, null);
    assert.equal(events.filter((event) => event === 'cancel').length, cancelCount);
  } finally {
    release.resolve();
    await voice.cancel();
  }
});

test('an old startup completion cannot abort a newer recording', async () => {
  const { voice, ports, events } = setup();
  const starting = deferred<void>();
  const release = deferred<void>();
  ports.start = async () => {
    starting.resolve();
    await release.promise;
  };
  const old = voice.start();
  await starting.promise;
  await voice.cancel();
  ports.start = async () => {};
  try {
    await voice.start();
    const id = voice.state.id;
    const aborts = events.filter((event) => event === 'abort').length;
    release.resolve();
    await old;
    assert.equal(voice.state.id, id);
    assert.equal(voice.state.phase, 'recording');
    assert.equal(events.filter((event) => event === 'abort').length, aborts);
  } finally {
    release.resolve();
    await voice.cancel();
  }
});

test('an old failure cleanup cannot add its error to a newer recording', async () => {
  const { voice, ports } = setup();
  const cleanup = deferred<void>();
  ports.cancel = () => cleanup.promise;
  await voice.start();
  const failing = voice.fail('旧录音失败');
  try {
    await voice.start();
    const id = voice.state.id;
    cleanup.resolve();
    await failing;
    assert.equal(voice.state.id, id);
    assert.equal(voice.state.phase, 'recording');
    assert.equal(voice.state.error, null);
  } finally {
    cleanup.resolve();
    await voice.cancel();
  }
});

test('cancel aborts only its pending transcription and a retry gets a fresh signal', async () => {
  const { voice, ports } = setup();
  const requests: { signal: AbortSignal; result: ReturnType<typeof deferred<string>> }[] = [];
  ports.stop = (signal) => {
    const result = deferred<string>();
    requests.push({ signal, result });
    return result.promise;
  };
  await voice.start();
  const old = voice.stop();
  await voice.cancel();
  await voice.start();
  const current = voice.stop();
  try {
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(requests[1].signal.aborted, false);
    requests[0].result.resolve('obsolete');
    await old;
    assert.equal(requests[1].signal.aborted, false);
    assert.equal(voice.state.phase, 'transcribing');
    requests[1].result.resolve('current');
    await current;
    assert.equal(voice.state.text, 'current');
  } finally {
    requests[0].result.resolve('obsolete');
    requests[1].result.resolve('current');
    await Promise.all([old, current]);
    await voice.cancel();
  }
});
