// Local HTTP bridge between the CLI (driven by the agent) and the app.
// Bound to 127.0.0.1 and gated by a per-run token from the state file.
const http = require('http');

const MAX_BODY = 4 * 1024 * 1024;

function send(res, status, obj) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(obj);
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  } catch {}
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function startServer({ token, routes, log }) {
  const server = http.createServer(async (req, res) => {
    if (req.headers['x-tma-token'] !== token) return send(res, 401, { error: 'bad token' });
    const url = new URL(req.url, 'http://127.0.0.1');
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const onAbort = (fn) => res.on('close', () => !res.writableFinished && fn());
      const out = await handler({ query: url.searchParams, body, onAbort, headers: req.headers });
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      log && log(`route ${url.pathname} failed: ${e.stack || e.message}`);
      send(res, e.status || 400, { error: e.message, reason: e.reason || undefined, denied: !!e.denied });
    }
  });
  server.requestTimeout = 0;
  server.keepAliveTimeout = 1000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

module.exports = { startServer };
