import { app, BrowserWindow } from 'electron';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { WindowsAdapter } from '../../src/host/windows.ts';

app.setPath('userData', process.env.TEACH_ME_AGENT_HOME!);
const events: { event: string; detail: Record<string, string | number | boolean> }[] = [];
const adapter = new WindowsAdapter((event, detail) => events.push({ event, detail }));
async function run() {
  await app.whenReady();
  const panel = new BrowserWindow({
    title: 'Teach me native helper fixture',
    width: 360,
    height: 120,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Only this fixture's own HWND is passed to the production Windows adapter.
  const handle = panel.getNativeWindowHandle().readBigUInt64LE().toString();
  await adapter.inputPolicy(handle, true, false);
  assert.ok((await adapter.windowStyle(handle)) & 0x08000000, 'NOACTIVATE applied');
  const child = Reflect.get(adapter, 'helper').child as ChildProcess;
  assert.ok(
    events.some((item) => item.event === 'native-helper-ready'),
    'real PS handshake',
  );
  await assert.rejects(adapter.inputPolicy('0', true, false), { code: 'NATIVE_POLICY_REJECTED' });

  // Suppress receipt of a real reply so exit reliably races a pending request.
  child.stdout!.pause();
  const pending = assert.rejects(adapter.windowStyle(handle), { code: 'NATIVE_HELPER_EXIT' });
  const exited = once(child, 'exit');
  child.kill();
  await pending;
  await exited;
  await adapter.inputPolicy(handle, true, true);
  const replacement = Reflect.get(adapter, 'helper').child as ChildProcess;
  assert.notEqual(replacement.pid, child.pid, 'next request uses a new helper');
  const style = await adapter.windowStyle(handle);
  assert.ok(style & 0x00040000, 'APPWINDOW preserved');
  assert.equal(style & 0x08000000, 0, 'input restored after helper exit');
  console.log('PASS: real helper exit settles pending request; next helper restores window policy');

  replacement.stdout!.pause();
  const disposed = assert.rejects(adapter.windowStyle(handle), { code: 'NATIVE_DISPOSED' });
  const replacementExited = once(replacement, 'exit');
  adapter.dispose();
  await disposed;
  await adapter.inputPolicy(handle, true, false);
  assert.ok((await adapter.windowStyle(handle)) & 0x08000000);
  assert.ok(events.some((item) => item.detail.reason === 'exit'));
  assert.ok(events.some((item) => item.detail.reason === 'native-rejected'));
  assert.ok(events.every((item) => !JSON.stringify(item).includes(handle)));
  console.log('CHECKS_COMPLETE: real native failure codes, disposal, replacement and style');
  const finalExited = once(Reflect.get(adapter, 'helper').child as ChildProcess, 'exit');
  adapter.dispose();
  await Promise.all([replacementExited, finalExited]);
  panel.destroy();
  app.quit();
}
run().catch((error) => {
  console.error(error);
  adapter.dispose();
  app.exit(1);
});
