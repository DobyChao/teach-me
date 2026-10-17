import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { failureMetadata, writeRuntimeEvent } from '../src/host/runtime-log.ts';

test('exit diagnostics retain exit status without exception text or credentials', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'teach-me-diagnostic-'));
  try {
    const error = Object.assign(new Error('private user text and secret-token'), { code: 'EPIPE' });
    writeRuntimeEvent(home, 'main-exception', failureMetadata(error));
    writeRuntimeEvent(home, 'launcher-exit', { exitCode: 3221225477, windowsCode: '0xc0000005' });
    const raw = await fs.readFile(path.join(home, 'runtime.log'), 'utf8');
    assert.ok(!raw.includes(error.message));
    const events = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events[0].name, 'Error');
    assert.equal(events[0].code, 'EPIPE');
    assert.equal(events[1].exitCode, 3221225477);
    assert.equal(events[1].windowsCode, '0xc0000005');
    assert.deepEqual(failureMetadata({ code: 'secret-token' }), { name: 'object', code: '' });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
