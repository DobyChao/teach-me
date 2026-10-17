import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pruneSessions } from '../src/host/storage.ts';
import { transcribe } from '../src/host/speech.ts';

async function temporary() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teach-me-platform-'));
  return {
    root,
    cleanup: async () => {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith('teach-me-platform-'));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
test('retention only removes expired session directories inside its own root', async () => {
  const { root, cleanup } = await temporary();
  try {
    const old = path.join(root, 'sessions', randomUUID());
    const recent = path.join(root, 'sessions', randomUUID());
    const other = path.join(root, 'sessions', 'user-folder');
    for (const folder of [old, recent, other]) await fs.mkdir(folder, { recursive: true });
    const earlier = new Date(Date.now() - 10 * 86400000);
    await fs.utimes(old, earlier, earlier);
    await fs.utimes(other, earlier, earlier);
    await pruneSessions(root, 7);
    await assert.rejects(fs.access(old));
    await fs.access(recent);
    await fs.access(other);
  } finally {
    await cleanup();
  }
});
test('failed local recognition still deletes the temporary audio file', async () => {
  const { root, cleanup } = await temporary();
  try {
    await assert.rejects(
      transcribe(
        new Uint8Array([0, 255]),
        'audio/webm',
        { engine: 'local', customUrl: '', localCommand: path.join(root, 'missing-recognizer.exe') },
        root,
      ),
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await cleanup();
  }
});
test('custom recognizer sends bytes to the configured local HTTP API and reads transcript', async () => {
  let received = 0;
  const server = createServer(async (req, res) => {
    for await (const bytes of req) received += bytes.length;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ text: '测试识别' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const text = await transcribe(
      new Uint8Array([1, 2, 3]),
      'audio/webm',
      { engine: 'custom', customUrl: `http://127.0.0.1:${address.port}`, localCommand: '' },
      os.tmpdir(),
    );
    assert.equal(text, '测试识别');
    assert.equal(received, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
