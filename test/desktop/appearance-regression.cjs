const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow, nativeTheme } = require('electron');
module.exports = async ({ panel, settingsWindow, state, act, until, home }) => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => panel.webContents.executeJavaScript(code);
  const settingsJs = (code) => settingsWindow.webContents.executeJavaScript(code);
  const overlay = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=overlay'),
  );
  const overlayJs = (code) => overlay.webContents.executeJavaScript(code);
  await act({ type: 'settings-focus', on: true });
  const dragId = require('node:crypto').randomUUID();
  const originalBounds = settingsWindow.getBounds();
  const originalContent = settingsWindow.getContentSize();
  const drag = (phase, dx = 0, dy = 0) =>
    settingsJs(
      'window.companion.perform(' +
        JSON.stringify({ type: 'settings-drag', phase, dragId, dx, dy }) +
        ')',
    );
  await drag('start');
  for (let i = 1; i <= 6; i++) await drag('move', i * 10, i * 5);
  await drag('end', 60, 30);
  assert.ok(
    settingsWindow.getContentSize().every((n, i) => Math.abs(n - originalContent[i]) <= 1),
    'client size remains stable within one fractional-DPI rounding unit',
  );
  assert.ok(Math.abs(settingsWindow.getBounds().x - originalBounds.x - 60) <= 1);
  assert.ok(Math.abs(settingsWindow.getBounds().y - originalBounds.y - 30) <= 1);
  const moved = settingsWindow.getBounds();
  await drag('move', 500, 500);
  assert.deepEqual(settingsWindow.getBounds(), moved, 'late drag ignored after release');
  for (let i = 0; i < 5; i++) {
    await drag('start');
    await drag('move', 5, 0);
    await drag('end', 5, 0);
  }
  assert.ok(
    settingsWindow.getContentSize().every((n, i) => Math.abs(n - originalContent[i]) <= 1),
    'separate gestures must not accumulate size drift',
  );
  await assert.rejects(
    js(
      'window.companion.perform(' +
        JSON.stringify({ type: 'settings-drag', phase: 'start', dragId, dx: 0, dy: 0 }) +
        ')',
    ),
    /settings drag sender rejected/,
  );
  assert.equal(settingsWindow.isResizable(), true);
  await settingsJs('document.querySelector("[data-color-mode=light]").click()');
  await until(() => settingsJs('document.documentElement.dataset.colorScheme==="light"'));
  assert.equal(await js('document.documentElement.dataset.colorScheme'), 'dark');
  const header = await settingsJs(
    '({drag:getComputedStyle(document.querySelector(".settings-header")).cursor,close:getComputedStyle(document.querySelector(".settings-close")).cursor})',
  );
  assert.deepEqual(header, { drag: 'grab', close: 'pointer' });
  await fs.writeFile(
    path.join(home, 'settings-light.png'),
    (await settingsWindow.capturePage()).toPNG(),
  );
  await settingsJs('document.querySelector(".settings-close").click()');
  await until(() => !settingsWindow.isVisible());
  assert.equal((await state()).settings.appearance.mode, 'dark');
  await act({ type: 'settings-focus', on: true });
  await until(() => settingsJs('document.documentElement.dataset.colorScheme==="dark"'));
  await fs.writeFile(
    path.join(home, 'settings-dark.png'),
    (await settingsWindow.capturePage()).toPNG(),
  );
  await settingsJs('document.querySelector("[data-color-mode=light]").click()');
  const savedWrite = fs.writeFile;
  fs.writeFile = async (file, ...args) => {
    if (file === path.join(home, 'settings.json')) throw new Error('合成主题保存失败');
    return savedWrite(file, ...args);
  };
  try {
    await settingsJs('document.querySelector(".primary").click()');
    await until(() => settingsJs('!!document.querySelector("[role=alert]")'));
    assert.equal((await state()).settings.appearance.mode, 'dark');
    assert.equal(await settingsJs('document.documentElement.dataset.colorScheme'), 'light');
  } finally {
    fs.writeFile = savedWrite;
  }
  await settingsJs('document.querySelector(".primary").click()');
  await until(() => !settingsWindow.isVisible());
  await until(() => js('document.documentElement.dataset.colorScheme==="light"'));
  await until(() => overlayJs('document.documentElement.dataset.colorScheme==="light"'));
  assert.equal(
    JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8')).appearance.mode,
    'light',
  );
  await act({ type: 'edit', on: true });
  await until(() => overlayJs('!!document.querySelector(".excalidraw canvas")'));
  await until(() => overlayJs('!!document.querySelector(".excalidraw:not(.theme--dark)")'));
  await overlayJs('document.querySelector("[data-testid=toolbar-rectangle]").click()');
  await pause(80);
  overlay.webContents.sendInputEvent({
    type: 'mouseDown',
    x: 400,
    y: 300,
    button: 'left',
    clickCount: 1,
  });
  await pause(30);
  overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 540, y: 390, button: 'left' });
  await pause(30);
  overlay.webContents.sendInputEvent({
    type: 'mouseUp',
    x: 540,
    y: 390,
    button: 'left',
    clickCount: 1,
  });
  await until(async () => (await state()).userBoard.count === 1);
  const board = (await state()).userBoard;
  await act({
    type: 'settings',
    settings: { ...(await state()).settings, appearance: { mode: 'dark', theme: 'rose' } },
  });
  await until(() => overlayJs('!!document.querySelector(".excalidraw.theme--dark")'));
  assert.deepEqual((await state()).userBoard, board);
  await overlayJs('document.querySelector("[data-testid=button-undo]").click()');
  await until(async () => (await state()).userBoard.count === 0);
  await overlayJs('document.querySelector("[data-testid=button-redo]").click()');
  await until(async () => (await state()).userBoard.count === 1);
  await act({ type: 'edit', on: false });
  await act({
    type: 'settings',
    settings: { ...(await state()).settings, appearance: { mode: 'system', theme: 'rose' } },
  });
  try {
    nativeTheme.themeSource = 'light';
    await until(() => js('document.documentElement.dataset.colorScheme==="light"'));
    nativeTheme.themeSource = 'dark';
    await until(() => js('document.documentElement.dataset.colorScheme==="dark"'));
    await until(() => overlayJs('document.documentElement.dataset.colorScheme==="dark"'));
  } finally {
    nativeTheme.themeSource = 'system';
  }
  await act({
    type: 'settings',
    settings: { ...(await state()).settings, appearance: { mode: 'dark', theme: 'rose' } },
  });
  assert.equal(await js('window.__composer.value'), '设置前保留的草稿');
  assert.equal(await js('window.__composer===document.querySelector("textarea")'), true);
  await act({ type: 'settings-focus', on: true });
  settingsWindow.setSize(440, 420);
  await pause(80);
  assert.equal(
    await settingsJs(
      '(()=>{const f=document.querySelector(".settings-footer").getBoundingClientRect();const b=document.querySelector(".primary").getBoundingClientRect();return f.bottom<=innerHeight+1&&b.right<=innerWidth+1&&b.top>=0&&document.querySelector(".settings-content").clientHeight>100})()',
    ),
    true,
  );
  settingsWindow.close();
  await until(() => !settingsWindow.isVisible());
};
