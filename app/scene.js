// Turns an agent-authored scene (coordinates in shot pixels) into overlay
// items (coordinates in display-local DIP), with warnings the agent can act on.
const { prepareHtml, clampHtmlRect, clampOpacity, clampTtl, SANDBOX } = require('../lib/html-sandbox');

const TYPES = {
  arrow: { points: ['to', 'from?'] },
  box: { rects: ['rect'] },
  click: { points: ['at'] },
  drag: { points: ['from', 'to'] },
  path: { lists: ['points'] },
  spotlight: { rects: ['rect'] },
  label: { points: ['at'], text: true },
  step: { points: ['at'] },
  keys: { points: ['at?'] },
  scroll: { points: ['at'] },
  stroke: { lists: ['points'] },
  html: { rects: ['rect'] },
};

function asPoint(v) {
  if (Array.isArray(v) && v.length >= 2) return [Number(v[0]), Number(v[1])];
  if (v && typeof v === 'object' && 'x' in v && 'y' in v) return [Number(v.x), Number(v.y)];
  return null;
}

function asRect(v) {
  if (Array.isArray(v) && v.length >= 4) return v.slice(0, 4).map(Number);
  if (v && typeof v === 'object' && 'x' in v) return [v.x, v.y, v.width ?? v.w, v.height ?? v.h].map(Number);
  return null;
}

function finite(arr) {
  return arr && arr.every((n) => Number.isFinite(n));
}

function screenShot(display) {
  return {
    id: 'screen',
    display: { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor },
    dipRect: { ...display.bounds },
    width: display.bounds.width,
    height: display.bounds.height,
  };
}

function resolveScene(scene, { shots, defaultShot, displays, primary }) {
  if (!scene || typeof scene !== 'object') throw new Error('scene must be a JSON object');
  const list = Array.isArray(scene.items) ? scene.items : Array.isArray(scene) ? scene : [];
  if (!list.length && !scene.say) throw new Error('scene has no "items" (and no "say")');
  const warnings = [];
  const items = [];
  const usedShots = new Set();

  const pickShot = (id) => {
    if (id === 'screen') return screenShot(primary);
    return shots.get(id || defaultShot || undefined);
  };

  list.forEach((raw, idx) => {
    const where = `items[${idx}]${raw && raw.type ? ` (${raw.type})` : ''}`;
    if (!raw || typeof raw !== 'object') return warnings.push(`${where}: not an object, skipped`);
    const spec = TYPES[raw.type];
    if (!spec) return warnings.push(`${where}: unknown type "${raw.type}", skipped. Known: ${Object.keys(TYPES).join(', ')}`);

    let shot;
    try {
      shot = pickShot(raw.shot || scene.shot);
    } catch (e) {
      return warnings.push(`${where}: ${e.message}, skipped`);
    }
    usedShots.add(shot.id);
    const display = displays.find((d) => d.id === shot.display.id) || primary;
    const ox = display.bounds.x;
    const oy = display.bounds.y;
    const sx = shot.dipRect.width / shot.width;
    const sy = shot.dipRect.height / shot.height;
    const mapPt = ([x, y]) => [shot.dipRect.x + x * sx - ox, shot.dipRect.y + y * sy - oy];
    const outside = ([x, y]) => x < -2 || y < -2 || x > shot.width + 2 || y > shot.height + 2;

    const out = {
      type: raw.type,
      label: raw.label != null ? String(raw.label) : undefined,
      color: typeof raw.color === 'string' ? raw.color : undefined,
      delay: Math.max(0, Number(raw.delay) || 0),
      ttl: Math.max(0, Number(raw.ttl) || 0),
    };
    let ok = true;

    for (const key of spec.points || []) {
      const name = key.replace('?', '');
      if (raw[name] == null) {
        if (!key.endsWith('?')) {
          warnings.push(`${where}: missing "${name}" [x,y], skipped`);
          ok = false;
        }
        continue;
      }
      const p = asPoint(raw[name]);
      if (!finite(p)) {
        warnings.push(`${where}: "${name}" must be [x,y], skipped`);
        ok = false;
        continue;
      }
      if (outside(p)) warnings.push(`${where}: ${name} [${p.map(Math.round)}] is outside ${shot.id} (${shot.width}x${shot.height})`);
      out[name] = mapPt(p);
    }

    for (const key of spec.rects || []) {
      const name = key.replace('?', '');
      if (raw[name] == null) {
        if (!key.endsWith('?')) {
          warnings.push(`${where}: missing "${name}" [x,y,w,h], skipped`);
          ok = false;
        }
        continue;
      }
      const r = asRect(raw[name]);
      if (!finite(r) || r[2] <= 0 || r[3] <= 0) {
        warnings.push(`${where}: "${name}" must be [x,y,w,h] with positive size, skipped`);
        ok = false;
        continue;
      }
      if (outside([r[0], r[1]]) || outside([r[0] + r[2], r[1] + r[3]]))
        warnings.push(`${where}: ${name} [${r.map(Math.round)}] reaches outside ${shot.id} (${shot.width}x${shot.height})`);
      const [x, y] = mapPt([r[0], r[1]]);
      out[name] = [x, y, r[2] * sx, r[3] * sy];
    }

    for (const key of spec.lists || []) {
      const pts = Array.isArray(raw[key]) ? raw[key].map(asPoint) : null;
      if (!pts || pts.length < 2 || !pts.every(finite)) {
        warnings.push(`${where}: "${key}" must be a list of at least two [x,y], skipped`);
        ok = false;
        continue;
      }
      if (pts.some(outside)) warnings.push(`${where}: some ${key} are outside ${shot.id} (${shot.width}x${shot.height})`);
      out[key] = pts.map(mapPt);
    }

    if (raw.type === 'label') {
      out.text = String(raw.text ?? raw.label ?? '');
      if (!out.text) {
        warnings.push(`${where}: label needs "text", skipped`);
        ok = false;
      }
    }
    if (raw.type === 'step') out.n = raw.n != null ? String(raw.n) : String(idx + 1);
    if (raw.type === 'click') out.button = ['left', 'right', 'double', 'middle'].includes(raw.button) ? raw.button : 'left';
    if (raw.type === 'scroll') out.direction = ['up', 'down', 'left', 'right'].includes(raw.direction) ? raw.direction : 'down';
    if (raw.type === 'keys') {
      const keys = Array.isArray(raw.keys) ? raw.keys : typeof raw.keys === 'string' ? raw.keys.split('+') : null;
      if (!keys || !keys.length) {
        warnings.push(`${where}: keys needs "keys": ["Ctrl","S"], skipped`);
        ok = false;
      } else out.keys = keys.map((k) => String(k).trim()).filter(Boolean);
    }
    if (raw.type === 'html') {
      if (raw.file != null) {
        warnings.push(`${where}: html file is not supported in v1 (text "html" only), skipped`);
        ok = false;
      }
      if (ok && out.rect) {
        const clamped = clampHtmlRect(out.rect, { width: display.bounds.width, height: display.bounds.height });
        if (!clamped.ok) {
          warnings.push(`${where}: html rect is invalid, skipped`);
          ok = false;
        } else {
          if (clamped.shrunk) warnings.push(`${where}: html rect was reduced so it cannot cover the screen`);
          out.rect = clamped.rect;
        }
      }
      if (ok) {
        try {
          const prepared = prepareHtml(raw.html, {
            color: out.color || '#ff3d7f',
            width: out.rect[2],
            height: out.rect[3],
            sx,
            sy,
            ox: shot.dipRect.x - ox - out.rect[0],
            oy: shot.dipRect.y - oy - out.rect[1],
          });
          const env = prepared.srcdoc;
          out.html = raw.html;
          out.srcdoc = env;
          out.hash = prepared.hash;
          out.bytes = prepared.bytes;
          out.sandbox = SANDBOX;
          out.opacity = clampOpacity(raw.opacity);
          out.ttl = clampTtl(raw.ttl);
          out.map = { sx, sy, ox: shot.dipRect.x - ox, oy: shot.dipRect.y - oy };
          out.viewport = { width: display.bounds.width, height: display.bounds.height };
        } catch (e) {
          warnings.push(`${where}: ${e.message}, skipped`);
          ok = false;
        }
      }
    }

    if (ok) {
      out.display = display.id;
      items.push(out);
    }
  });

  return { items, warnings, shots: [...usedShots] };
}

module.exports = { resolveScene, TYPES };
