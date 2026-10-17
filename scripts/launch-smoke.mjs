// Real launcher regression: duplicate startup, idle, forced termination, graceful shutdown.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults } from '../src/shared/protocol.ts';

const home = path.resolve('.runtime/launch-smoke');
await fs.mkdir(home, { recursive: true });
await fs.rm(path.join(home, 'endpoint.json'), { force: true });
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({ ...defaults, showInScreenCapture: true }),
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const env = { ...process.env, TEACH_ME_AGENT_HOME: home };
function launch() {
  const child = spawn(process.execPath, ['scripts/launch.mjs'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (v) => (out += v));
  child.stderr.on('data', (v) => (out += v));
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal, out }));
  });
  return { child, exited };
}
async function endpoint() {
  for (let i = 0; i < 150; i++) {
    try {
      const e = JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
      await post(e, 'status');
      return e;
    } catch {
      await pause(100);
    }
  }
  throw new Error('launcher did not publish a live endpoint');
}
async function post(e, route) {
  const r = await fetch(`http://127.0.0.1:${e.port}/${route}`, {
    method: 'POST',
    headers: { 'x-companion-token': e.token, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(3000),
  });
  assert.ok(r.ok);
  return r.json();
}
async function events() {
  return (await fs.readFile(path.join(home, 'runtime.log'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
let live;
let launchProcess;
try {
  launchProcess = launch();
  live = await endpoint();
  const duplicate = launch();
  const repeated = await duplicate.exited;
  assert.equal(repeated.code, 0);
  assert.match(repeated.out, /应用已在运行/);
  assert.equal((await endpoint()).pid, live.pid);
  assert.equal(launchProcess.child.exitCode, null);
  const idleMs = Number(process.env.TMA_IDLE_MS || 120000);
  const started = Date.now();
  while (Date.now() - started < idleMs) {
    await post(live, 'status');
    assert.equal(launchProcess.child.exitCode, null, 'the original launcher stays running');
    await pause(1000);
  }
  console.log(`PASS: duplicate startup preserves PID; ${idleMs}ms idle stays online`);
  const killedPid = live.pid;
  process.kill(killedPid);
  live = null;
  const killed = await launchProcess.exited;
  assert.notEqual(killed.code, 0);
  const abnormal = (await events()).find(
    (e) => e.event === 'launcher-exit' && e.childPid === killedPid,
  );
  assert.ok(abnormal);
  assert.notEqual(abnormal.exitCode, 0);
  assert.ok(!(await events()).some((e) => e.event === 'quit' && e.pid === killedPid));
  console.log(`PASS: externally terminated host recorded ${abnormal.windowsCode}`);
  await fs.rm(path.join(home, 'endpoint.json'), { force: true });
  launchProcess = launch();
  live = await endpoint();
  const stoppedPid = live.pid;
  await post(live, 'stop');
  live = null;
  const stopped = await launchProcess.exited;
  assert.equal(stopped.code, 0);
  assert.ok((await events()).some((e) => e.event === 'quit' && e.pid === stoppedPid));
  assert.ok(
    (await events()).some(
      (e) => e.event === 'launcher-exit' && e.childPid === stoppedPid && e.exitCode === 0,
    ),
  );
  console.log('PASS: graceful shutdown records host quit and launcher exit 0');
} finally {
  if (live) await post(live, 'stop').catch(() => process.kill(live.pid));
  if (launchProcess?.child.exitCode === null) await launchProcess.exited;
}
