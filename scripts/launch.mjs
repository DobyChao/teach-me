import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { failureMetadata, writeRuntimeEvent } from '../src/host/runtime-log.ts';
const require = createRequire(import.meta.url);
const home =
  process.env.TEACH_ME_AGENT_HOME ||
  path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'teach-me-agent-v2');
const started = Date.now();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('spawn', () => {
  writeRuntimeEvent(home, 'launcher-start', { childPid: child.pid });
  console.log(`Electron 已启动（PID ${child.pid}）；退出诊断：${path.join(home, 'runtime.log')}`);
});
child.on('error', (e) => {
  writeRuntimeEvent(home, 'launcher-error', failureMetadata(e));
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  const detail = {
    childPid: child.pid || 0,
    exitCode: code ?? 'none',
    windowsCode: code === null ? 'none' : `0x${(code >>> 0).toString(16).padStart(8, '0')}`,
    signal: signal || 'none',
    uptimeMs: Date.now() - started,
  };
  writeRuntimeEvent(home, 'launcher-exit', detail);
  console.error(
    `Electron 已退出：code=${detail.exitCode} (${detail.windowsCode}), signal=${detail.signal}, 运行 ${(detail.uptimeMs / 1000).toFixed(1)} 秒。`,
  );
  process.exitCode = code ?? 1;
});
