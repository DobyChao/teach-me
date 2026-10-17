import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
// @ts-expect-error CLI is JavaScript and intentionally independent of the host bundle.
import { postJson } from '../bin/http.mjs';

test('CLI transport accepts delayed headers and fragmented JSON', async () => {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { timeoutMs: 480000 });
    assert.equal(req.headers['x-session-token'], 'fixture');
    setTimeout(() => {
      res.writeHead(200);
      res.write('{"messages":');
      setTimeout(() => res.end('[]}'), 30);
    }, 60);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    assert.deepEqual(
      await postJson(
        address.port,
        'wait',
        { 'x-session-token': 'fixture' },
        { timeoutMs: 480000 },
        1000,
      ),
      { messages: [] },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('CLI transport reports rejection and explicit deadline; silent sockets are closed', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/reject') {
      res.writeHead(400);
      res.end('{"error":"需要重新连接"}');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(postJson(address.port, 'reject', {}, {}, 1000), /需要重新连接/);
    await assert.rejects(postJson(address.port, 'wait', {}, {}, 50), /应用请求超时/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
