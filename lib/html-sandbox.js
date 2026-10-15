// Custom HTML guides: text only, one srcdoc iframe, sandbox allow-scripts
// and never allow-same-origin. Host draws the watermark; this module only
// prepares the document and the limits the host enforces.

const crypto = require('crypto');

const MAX_HTML_BYTES = 256 * 1024;
const MAX_TTL_MS = 60 * 1000;
const DEFAULT_TTL_MS = 60 * 1000;
const MIN_OPACITY = 0.85;
const MAX_AREA_RATIO = 0.4;
const SCREEN_MARGIN = 48;
const SANDBOX = 'allow-scripts';
const CSP = [
  "default-src 'none'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data: blob:',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
].join('; ');

function shouldRestoreHtmlAfterCrash() {
  return false;
}

function assertSandbox(attr) {
  const tokens = String(attr || '')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length !== 1 || tokens[0] !== 'allow-scripts') {
    throw new Error('html sandbox must be exactly allow-scripts');
  }
  if (tokens.includes('allow-same-origin')) throw new Error('html sandbox must not allow-same-origin');
  return SANDBOX;
}

function clampOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return MIN_OPACITY;
  return Math.min(1, Math.max(MIN_OPACITY, n));
}

function clampTtl(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.round(n));
}

function clampHtmlRect(rect, viewport) {
  if (!rect || rect.length < 4) return { ok: false, reason: 'missing-rect' };
  let [x, y, w, h] = rect.map(Number);
  const vw = viewport && viewport.width;
  const vh = viewport && viewport.height;
  if (![x, y, w, h, vw, vh].every((n) => Number.isFinite(n)) || w <= 0 || h <= 0 || vw <= 0 || vh <= 0) {
    return { ok: false, reason: 'bad-rect' };
  }
  const maxW = Math.max(32, vw - SCREEN_MARGIN * 2);
  const maxH = Math.max(32, vh - SCREEN_MARGIN * 2);
  let shrunk = false;
  if (w > maxW || h > maxH) {
    const s = Math.min(maxW / w, maxH / h);
    w *= s;
    h *= s;
    shrunk = true;
  }
  const maxArea = vw * vh * MAX_AREA_RATIO;
  if (w * h > maxArea) {
    const s = Math.sqrt(maxArea / (w * h));
    w *= s;
    h *= s;
    shrunk = true;
  }
  w = Math.max(32, Math.round(w));
  h = Math.max(32, Math.round(h));
  const maxX = vw - w - SCREEN_MARGIN;
  const maxY = vh - h - SCREEN_MARGIN;
  const nx = Math.round(Math.min(Math.max(x, SCREEN_MARGIN), Math.max(SCREEN_MARGIN, maxX)));
  const ny = Math.round(Math.min(Math.max(y, SCREEN_MARGIN), Math.max(SCREEN_MARGIN, maxY)));
  if (nx !== Math.round(x) || ny !== Math.round(y)) shrunk = true;
  return { ok: true, rect: [nx, ny, w, h], shrunk };
}

function wrapSrcdoc(html, env) {
  const safeEnv = JSON.stringify(env || {}).replace(/</g, '\\u003c');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    '<style>html,body{margin:0;background:transparent;overflow:hidden;color-scheme:normal}</style>' +
    `<script>(function(){var t=${safeEnv};` +
    't.pt=function(x,y){return [x*t.sx+t.ox,y*t.sy+t.oy]};' +
    't.rect=function(x,y,w,h){var a=t.pt(x,y);return [a[0],a[1],w*t.sx,h*t.sy]};' +
    'window.TMA=t;})()</script>' +
    `</head><body>${html}</body></html>`
  );
}

function prepareHtml(html, env) {
  if (typeof html !== 'string' || !html.trim()) {
    const err = new Error('html needs a text "html" string');
    err.code = 'HTML_EMPTY';
    throw err;
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_HTML_BYTES) {
    const err = new Error(`html is larger than ${MAX_HTML_BYTES / 1024} KB`);
    err.code = 'HTML_TOO_LARGE';
    throw err;
  }
  const hash = crypto.createHash('sha256').update(html).digest('hex');
  return {
    srcdoc: wrapSrcdoc(html, env),
    hash,
    bytes,
    sandbox: assertSandbox(SANDBOX),
    csp: CSP,
  };
}

module.exports = {
  MAX_HTML_BYTES,
  MAX_TTL_MS,
  DEFAULT_TTL_MS,
  MIN_OPACITY,
  MAX_AREA_RATIO,
  SCREEN_MARGIN,
  SANDBOX,
  CSP,
  shouldRestoreHtmlAfterCrash,
  assertSandbox,
  clampOpacity,
  clampTtl,
  clampHtmlRect,
  wrapSrcdoc,
  prepareHtml,
};
