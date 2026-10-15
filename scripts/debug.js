// Dev helper for the routes the app exposes when started with TMA_DEBUG=1.
//   node scripts/debug.js capture panel|freeze|overlay[:displayId]
//   node scripts/debug.js eval <target> <js | file.js>
//   node scripts/debug.js hotkey freeze|talk|toggleOverlay
//   node scripts/debug.js input <target> <events.json>
const fs = require('fs');
const http = require('http');
const P = require('../lib/paths');

const [cmd, target, arg] = process.argv.slice(2);
const st = P.readState();
if (!st) {
  console.error('app is not running');
  process.exit(1);
}

const fileOr = (v) => (v && fs.existsSync(v) ? fs.readFileSync(v, 'utf8') : v);
const bodies = {
  capture: () => ['/debug/capture', { target }],
  eval: () => ['/debug/eval', { target, js: fileOr(arg) }],
  hotkey: () => ['/debug/hotkey', { name: target }],
  input: () => ['/debug/input', { target, events: JSON.parse(fileOr(arg)) }],
};
if (!bodies[cmd]) {
  console.error('usage: capture|eval|hotkey|input ...');
  process.exit(1);
}
const [route, body] = bodies[cmd]();
const data = Buffer.from(JSON.stringify(body));
const req = http.request(
  {
    host: '127.0.0.1',
    port: st.port,
    path: route,
    method: 'POST',
    headers: { 'x-tma-token': st.token, 'content-type': 'application/json', 'content-length': data.length },
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => console.log(Buffer.concat(chunks).toString('utf8')));
  },
);
req.on('error', (e) => console.error(e.message));
req.end(data);
