#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { postJson } from './http.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home =
  process.env.TEACH_ME_AGENT_HOME ||
  path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'teach-me-agent-v2');
const args = process.argv.slice(2);
const command = args.shift() || 'help';
const flags = {};
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    flags[key] = ['all', 'agent', 'json'].includes(key) ? true : args[++i];
  } else words.push(args[i]);
}
const endpointFile = path.join(home, 'endpoint.json');
const client = String(
  flags.client || process.env.TEACH_ME_CLIENT || process.env.CODEX_THREAD_ID || 'default',
);
const driverFile = path.join(
  home,
  'clients',
  createHash('sha256').update(client).digest('hex') + '.json',
);
async function saveDriver() {
  await fs.mkdir(path.dirname(driverFile), { recursive: true });
  await fs.writeFile(driverFile, JSON.stringify(driver), { mode: 0o600 });
}
const read = async (file) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let endpoint = await read(endpointFile);
let driver = await read(driverFile);
async function call(route, data = {}, timeout = 30000) {
  if (!endpoint) throw new Error('应用未启动。先运行 start。');
  return postJson(
    endpoint.port,
    route,
    {
      'x-companion-token': endpoint.token,
      ...(driver ? { 'x-session-token': driver.token } : {}),
    },
    data,
    timeout,
  );
}
async function alive() {
  try {
    await call('status');
    return true;
  } catch {
    return false;
  }
}
const out = (value) =>
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
try {
  if (command === 'help') {
    out(
      `Teach me, Agent · 只指不代操作\n\nnode bin/teach-me.mjs <命令>\n  start [--topic 主题]  启动应用并开始教学\n  attach --session ID  请求连接已有教学\n  wait [--timeout 秒]  等待用户消息（默认 480 秒）\n  say 文字             在面板说一句\n  show JSON或文件      画指引，必须带 say\n  capture              经过用户审批取图\n  clear [--all]        清 Agent 指引；all 也清用户笔迹\n  board / status       查看状态\n  stop                 退出应用\n\nshow 示例：{\"say\":\"点这里\",\"pattern\":\"point\",\"to\":[100,100]}\n坐标使用最近截图的像素。截图以路径返回，请用 Agent 的图片工具打开。`,
    );
  } else if (command === 'start') {
    let secret = '';
    if (!(await alive())) {
      await fs.mkdir(home, { recursive: true });
      await fs.access(path.join(root, 'dist/host/main.cjs')).catch(() => {
        throw new Error('请先运行 npm run build');
      });
      secret = randomUUID();
      const env = { ...process.env, TMA_LAUNCH_SECRET: secret };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [root], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env,
      });
      child.on('error', () => {});
      child.unref();
      for (let n = 0; n < 100; n++) {
        await pause(150);
        endpoint = await read(endpointFile);
        if (await alive()) break;
      }
      if (!(await alive())) throw new Error('Electron 未能启动，请运行 npm run app 查看错误。');
    }
    driver = await call(
      'start',
      {
        topic: flags.topic || '',
        launchSecret: secret,
        displayId: flags.display ? Number(flags.display) : undefined,
      },
      65000,
    );
    await saveDriver();
    out(driver);
  } else if (command === 'attach') {
    driver = await call('attach', { session: flags.session }, 65000);
    await saveDriver();
    out(driver);
  } else if (command === 'wait') {
    const seconds = Number(flags.timeout ?? 480);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 480)
      throw new Error('timeout 必须在 1–480 秒之间');
    const result = await call('wait', { timeoutMs: seconds * 1000 }, seconds * 1000 + 10000);
    // Print before ack: a process killed before this output will redeliver.
    await new Promise((resolve, reject) =>
      process.stdout.write(JSON.stringify(result, null, 2) + '\n', (err) =>
        err ? reject(err) : resolve(),
      ),
    );
    if (result.messages?.length)
      await call('ack', { id: Math.max(...result.messages.map((m) => m.id)) });
  } else if (command === 'say') out(await call('say', { text: words.join(' ') }));
  else if (command === 'show') {
    let text = words.join(' ');
    if (!text.trim().startsWith('{')) text = await fs.readFile(text, 'utf8');
    out(await call('show', JSON.parse(text)));
  } else if (command === 'zoom') {
    if (typeof flags.rect !== 'string') throw new Error('zoom 需要 --rect x,y,w,h');
    out(await call('zoom', { shot: flags.shot, rect: flags.rect.split(',').map(Number) }));
  } else if (command === 'clear') out(await call('clear', { all: !!flags.all }));
  else if (['status', 'board', 'capture', 'stop'].includes(command))
    out(await call(command, {}, command === 'capture' ? 100000 : 30000));
  else throw new Error(`未知命令：${command}`);
} catch (e) {
  console.error(`teach-me: ${e.message}`);
  process.exitCode = 1;
}
