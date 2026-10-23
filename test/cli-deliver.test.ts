import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The CLI is plain JavaScript driving the app's local HTTP endpoint; these
// tests spawn it against a fixture server so delivery, waiting and ack
// ordering are exercised in a real child process without the Electron host.
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'teach-me.mjs');
const waitResult = {
  messages: [{ id: 7, role: 'user', text: '好了', at: 1, shots: [] }],
  ended: false,
  timeout: false,
};

interface Received {
  route: string;
  body: unknown;
}

async function startFixture() {
  const calls: Received[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: string) => (raw += chunk));
    req.on('end', () => {
      calls.push({ route: req.url || '', body: raw ? JSON.parse(raw) : {} });
      const respond = (value: unknown, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/say') respond({ ok: true });
      else if (req.url === '/show') respond({ drawn: 1 });
      else if (req.url === '/wait') setTimeout(() => respond(waitResult), 20);
      else if (req.url === '/ack') respond({ ok: true });
      else respond({ error: `unexpected route ${req.url}` }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    calls,
    port: (server.address() as { port: number }).port,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

function runCli(args: string[], home: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, TEACH_ME_AGENT_HOME: home },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function withHome(port: number, fn: (home: string) => Promise<void>) {
  const home = mkdtempSync(path.join(tmpdir(), 'tma-deliver-'));
  writeFileSync(path.join(home, 'endpoint.json'), JSON.stringify({ port, token: 'fixture' }));
  try {
    await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('say --wait delivers, prints combined JSON, then acknowledges', async () => {
  const fixture = await startFixture();
  try {
    await withHome(fixture.port, async (home) => {
      const run = await runCli(['say', '先点这里', '--wait', '--timeout', '5'], home);
      assert.equal(run.code, 0);
      assert.equal(run.stderr, '');
      assert.deepEqual(JSON.parse(run.stdout), { delivered: { ok: true }, ...waitResult });
      assert.deepEqual(
        fixture.calls.map((c) => c.route),
        ['/say', '/wait', '/ack'],
      );
      assert.deepEqual(fixture.calls[0].body, { text: '先点这里' });
      assert.deepEqual(fixture.calls[1].body, { timeoutMs: 5000 });
      assert.deepEqual(fixture.calls[2].body, { id: 7 });
    });
  } finally {
    await fixture.close();
  }
});

test('show --wait returns drawn plus the wait result in one process', async () => {
  const fixture = await startFixture();
  try {
    await withHome(fixture.port, async (home) => {
      const scene = { say: '点这里打开文件。', shot: 's1', pattern: 'point', to: [100, 80] };
      const run = await runCli(['show', JSON.stringify(scene), '--wait'], home);
      assert.equal(run.code, 0);
      assert.deepEqual(JSON.parse(run.stdout), { delivered: { drawn: 1 }, ...waitResult });
      assert.deepEqual(fixture.calls[0], { route: '/show', body: scene });
      assert.deepEqual(fixture.calls[1].body, { timeoutMs: 480000 });
      assert.deepEqual(fixture.calls[2].body, { id: 7 });
    });
  } finally {
    await fixture.close();
  }
});

test('say without --wait neither polls nor acknowledges', async () => {
  const fixture = await startFixture();
  try {
    await withHome(fixture.port, async (home) => {
      const run = await runCli(['say', '你好'], home);
      assert.equal(run.code, 0);
      assert.deepEqual(JSON.parse(run.stdout), { ok: true });
      assert.deepEqual(
        fixture.calls.map((c) => c.route),
        ['/say'],
      );
    });
  } finally {
    await fixture.close();
  }
});

test('invalid combined timeout fails before any delivery', async () => {
  const fixture = await startFixture();
  try {
    await withHome(fixture.port, async (home) => {
      const run = await runCli(['say', 'x', '--wait', '--timeout', '0'], home);
      assert.equal(run.code, 1);
      assert.match(run.stderr, /timeout/);
      assert.deepEqual(fixture.calls, []);
    });
  } finally {
    await fixture.close();
  }
});
