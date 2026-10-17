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
    stop: async () => {
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
