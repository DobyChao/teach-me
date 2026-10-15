const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  SANDBOX,
  CSP,
  MAX_HTML_BYTES,
  prepareHtml,
  assertSandbox,
  clampHtmlRect,
  clampOpacity,
  clampTtl,
  shouldRestoreHtmlAfterCrash,
  MAX_TTL_MS,
} = require('../lib/html-sandbox');

test('sandbox is allow-scripts and never allow-same-origin', () => {
  assert.equal(SANDBOX, 'allow-scripts');
  assert.equal(assertSandbox(SANDBOX), 'allow-scripts');
  assert.throws(() => assertSandbox('allow-scripts allow-same-origin'));
  assert.throws(() => assertSandbox('allow-scripts allow-popups'));
  assert.match(CSP, /default-src 'none'/);
  assert.match(CSP, /img-src data: blob:/);
  assert.match(CSP, /script-src 'unsafe-inline'/);
  assert.match(CSP, /style-src 'unsafe-inline'/);
});

test('prepareHtml wraps text, records a hash, and rejects a file-sized body', () => {
  const prepared = prepareHtml('<b>hi</b><script>window.open("https://evil")</script>', { color: '#ff3d7f' });
  assert.equal(prepared.sandbox, 'allow-scripts');
  assert.equal(prepared.hash.length, 64);
  assert.match(prepared.srcdoc, /default-src 'none'/);
  assert.match(prepared.srcdoc, /<b>hi<\/b>/);
  assert.doesNotMatch(prepared.srcdoc, /allow-same-origin/);
  assert.throws(() => prepareHtml(''), /html/);
  assert.throws(() => prepareHtml('x'.repeat(MAX_HTML_BYTES + 1)), /larger than/);
});

test('html cannot cover the screen and cannot be fully transparent', () => {
  const full = clampHtmlRect([0, 0, 1920, 1080], { width: 1920, height: 1080 });
  assert.equal(full.ok, true);
  assert.equal(full.shrunk, true);
  const [x, y, w, h] = full.rect;
  assert.ok(x >= 48 && y >= 48);
  assert.ok(w < 1920 - 48 && h < 1080 - 48);
  assert.ok(w * h <= 1920 * 1080 * 0.4 + 1);
  assert.equal(clampOpacity(0), 0.85);
  assert.equal(clampOpacity(0.99), 0.99);
  assert.equal(clampTtl(0), 60000);
  assert.equal(clampTtl(MAX_TTL_MS * 10), MAX_TTL_MS);
});

test('a crashed html guide is not restored', () => {
  assert.equal(shouldRestoreHtmlAfterCrash(), false);
});

test('the host frame sets sandbox, CSP, and a fixed watermark', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'ui', 'html-frame.html'), 'utf8');
  const host = fs.readFileSync(path.join(__dirname, '..', 'app', 'html-window.js'), 'utf8');
  assert.match(html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.match(html, /AI 指引/);
  assert.match(html, /default-src 'none'/);
  assert.match(host, /nodeIntegration:\s*false/);
  assert.match(host, /contextIsolation:\s*true/);
  assert.match(host, /sandbox:\s*true/);
  assert.match(host, /preload:\s*undefined/);
  assert.match(host, /shouldRestoreHtmlAfterCrash/);
  assert.match(host, /setWindowOpenHandler/);
  assert.match(host, /will-navigate/);
  assert.match(host, /will-download/);
  const overlay = fs.readFileSync(path.join(__dirname, '..', 'app', 'ui', 'overlay.js'), 'utf8');
  assert.doesNotMatch(overlay, /srcdoc/);
  assert.doesNotMatch(overlay, /allow-same-origin/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  assert.match(main, /withoutCaptureContext/);
  assert.match(main, /decideStart/);
  assert.match(main, /decideAttach/);
  assert.match(main, /createHtmlHost/);
  assert.match(main, /MAX_ATTEMPTS/);
});
