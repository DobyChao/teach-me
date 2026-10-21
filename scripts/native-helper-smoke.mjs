import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await build({
  entryPoints: ['test/desktop/native-helper.ts'],
  outfile: 'dist/test/native-helper.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const home = path.resolve('.runtime/native-helper', String(Date.now()));
await fs.mkdir(home, { recursive: true });
const env = { ...process.env, TEACH_ME_AGENT_HOME: home };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron'), ['dist/test/native-helper.cjs'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => (output += chunk));
const code = await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => {
    child.kill();
    reject(new Error(`native helper smoke timed out\n${output}`));
  }, 60000);
  child.once('error', (error) => {
    clearTimeout(deadline);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(deadline);
    resolve(code);
  });
});
assert.equal(code, 0, output);
assert.match(output, /CHECKS_COMPLETE/);
