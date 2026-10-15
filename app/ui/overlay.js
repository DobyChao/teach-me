const SVGNS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('svg');
const layer = document.getElementById('layer');
const under = document.getElementById('under');
const ACCENT = '#ff3d7f';
const POINTER_D = 'M0,0 L0,21 L5.2,16.2 L8.8,24.6 L12.4,23 L8.9,14.8 L15.8,14.8 Z';

let timers = [];
let live = [];

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function div(cls, parent, text) {
  const n = document.createElement('div');
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

function W() {
  return window.innerWidth;
}
function H() {
  return window.innerHeight;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function unit(x, y) {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

// Places a bubble next to an anchor point, on the side given by (dx, dy),
// keeping it fully on screen.
function bubble(text, ax, ay, dx, dy, parent, gap = 12) {
  const b = div('bubble', parent, text);
  const w = b.offsetWidth;
  const h = b.offsetHeight;
  let x;
  let y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    x = dx >= 0 ? ax + gap : ax - gap - w;
    y = ay - h / 2;
  } else {
    y = dy >= 0 ? ay + gap : ay - gap - h;
    x = ax - w / 2;
  }
  b.style.left = clamp(x, 8, W() - w - 8) + 'px';
  b.style.top = clamp(y, 8, H() - h - 8) + 'px';
  return b;
}

function headPoints(tx, ty, ex, ey, size = 20, width = 11) {
  const bx = tx - ex * size;
  const by = ty - ey * size;
  return [
    [tx, ty],
    [bx - ey * width, by + ex * width],
    [bx + ey * width, by - ex * width],
  ]
    .map((p) => p.join(','))
    .join(' ');
}

function drawIn(path) {
  const len = path.getTotalLength();
  path.style.strokeDasharray = `${len} ${len}`;
  path.style.strokeDashoffset = String(len);
  path.classList.add('draw');
}

function autoFrom(tx, ty) {
  let [vx, vy] = [W() / 2 - tx, H() / 2 - ty];
  if (Math.hypot(vx, vy) < 80) [vx, vy] = [-1, 1];
  [vx, vy] = unit(vx, vy);
  const a = 0.55;
  const rx = vx * Math.cos(a) - vy * Math.sin(a);
  const ry = vx * Math.sin(a) + vy * Math.cos(a);
  const d = 150;
  return [clamp(tx + rx * d, 30, W() - 30), clamp(ty + ry * d, 30, H() - 30)];
}

function smooth(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1} ${c2} ${p2}`;
  }
  return d;
}

function mover(g, d, { hold = true, dur = 2.2 } = {}) {
  const m = el('g', { class: 'mover' }, g);
  el('circle', { class: 'press', r: 11 }, m);
  el('path', { class: 'ptr', d: POINTER_D }, m);
  const anim = el('animateMotion', { dur: dur + 's', repeatCount: 'indefinite', path: d, calcMode: 'linear' }, m);
  if (hold) {
    anim.setAttribute('keyPoints', '0;0;1;1');
    anim.setAttribute('keyTimes', '0;0.18;0.8;1');
  }
  return m;
}

const RENDER = {
  arrow(it, g, box) {
    const [tx0, ty0] = it.to;
    const [fx, fy] = it.from || autoFrom(tx0, ty0);
    const [dx, dy] = [tx0 - fx, ty0 - fy];
    const len = Math.hypot(dx, dy) || 1;
    const [nx, ny] = [-dy / len, dx / len];
    const bend = Math.min(70, len * 0.2);
    const cx = (fx + tx0) / 2 + nx * bend;
    const cy = (fy + ty0) / 2 + ny * bend;
    const [ex, ey] = unit(tx0 - cx, ty0 - cy);
    const gap = it.gap != null ? it.gap : 6;
    const [tx, ty] = [tx0 - ex * gap, ty0 - ey * gap];
    const [lx, ly] = [tx - ex * 14, ty - ey * 14];
    const d = `M${fx},${fy} Q${cx},${cy} ${lx},${ly}`;

    const a = el('g', { class: 'arrow poke' }, g);
    a.style.setProperty('--px', `${-ex * 7}px`);
    a.style.setProperty('--py', `${-ey * 7}px`);
    drawIn(el('path', { class: 'halo', d }, a));
    drawIn(el('path', { class: 'line', d }, a));
    el('polygon', { class: 'head', points: headPoints(tx, ty, ex, ey) }, a);

    if (it.label) {
      const [sx, sy] = unit(cx - fx, cy - fy);
      bubble(it.label, fx, fy, -sx, -sy, box, 10);
    }
  },

  box(it, g, box) {
    const [x, y, w, h] = it.rect;
    const pad = 4;
    const b = div('box', box);
    Object.assign(b.style, { left: x - pad + 'px', top: y - pad + 'px', width: w + pad * 2 + 'px', height: h + pad * 2 + 'px' });
    if (it.label) {
      const above = y - pad > 60;
      bubble(it.label, x + Math.min(w / 2, 160), above ? y - pad : y + h + pad, 0, above ? -1 : 1, box, 10);
    }
  },

  spotlight(it, g, box) {
    const [x, y, w, h] = it.rect;
    const pad = 6;
    const s = div('spot', box);
    Object.assign(s.style, { left: x - pad + 'px', top: y - pad + 'px', width: w + pad * 2 + 'px', height: h + pad * 2 + 'px' });
    if (it.label) {
      const below = y + h + pad + 70 < H();
      bubble(it.label, x + w / 2, below ? y + h + pad : y - pad, 0, below ? 1 : -1, box, 12);
    }
  },

  click(it, g, box) {
    const [x, y] = it.at;
    const c = div('click' + (it.button === 'double' ? ' double' : ''), box);
    Object.assign(c.style, { left: x + 'px', top: y + 'px' });
    div('ring', c);
    div('ring r2', c);
    div('dot', c);
    const cur = el('svg', { class: 'cursor', viewBox: '-1 -1 18 27' });
    el('path', { class: 'ptr', d: POINTER_D }, cur);
    c.appendChild(cur);
    const tag = { right: '右键', double: '双击', middle: '中键' }[it.button];
    if (tag) div('tag', c, tag);
    if (it.label) bubble(it.label, x + 26, y, 1, 0, box, 8);
  },

  drag(it, g, box) {
    const [fx, fy] = it.from;
    const [tx, ty] = it.to;
    const len = Math.hypot(tx - fx, ty - fy) || 1;
    const [nx, ny] = [-(ty - fy) / len, (tx - fx) / len];
    const bend = Math.min(50, len * 0.12);
    const cx = (fx + tx) / 2 + nx * bend;
    const cy = (fy + ty) / 2 + ny * bend;
    const d = `M${fx},${fy} Q${cx},${cy} ${tx},${ty}`;
    el('path', { class: 'track-halo', d }, g);
    el('path', { class: 'track', d }, g);
    el('circle', { class: 'endpoint', cx: fx, cy: fy, r: 6 }, g);
    el('circle', { class: 'target', cx: tx, cy: ty, r: 15 }, g);
    mover(g, d);
    if (it.label) bubble(it.label, cx + nx * 18, cy + ny * 18, nx, ny, box, 6);
  },

  path(it, g, box) {
    const pts = it.points;
    const d = smooth(pts);
    el('path', { class: 'track-halo', d }, g);
    el('path', { class: 'track', d }, g);
    el('circle', { class: 'endpoint', cx: pts[0][0], cy: pts[0][1], r: 6 }, g);
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const [ex, ey] = unit(last[0] - prev[0], last[1] - prev[1]);
    el('polygon', { class: 'head', points: headPoints(last[0], last[1], ex, ey, 16, 9), style: 'opacity:1;animation:none' }, g);
    mover(g, d, { hold: false, dur: Math.max(1.6, pts.length * 0.6) });
    if (it.label) {
      const mid = pts[Math.floor(pts.length / 2)];
      bubble(it.label, mid[0], mid[1] - 14, 0, -1, box, 8);
    }
  },

  label(it, g, box) {
    const [x, y] = it.at;
    const b = div('bubble', box, it.text);
    b.style.left = clamp(x, 8, W() - b.offsetWidth - 8) + 'px';
    b.style.top = clamp(y, 8, H() - b.offsetHeight - 8) + 'px';
  },

  step(it, g, box) {
    const [x, y] = it.at;
    const s = div('step', box, it.n);
    Object.assign(s.style, { left: x + 'px', top: y + 'px' });
    if (it.label) bubble(it.label, x + 18, y, 1, 0, box, 6);
  },

  keys(it, g, box) {
    const k = div('keys', box);
    const row = div('row', k);
    it.keys.forEach((name, i) => {
      if (i) div('plus', row, '+');
      const kbd = div('kbd', row, name);
      kbd.style.animationDelay = `${i * 0.14}s`;
    });
    if (it.label) div('', k, it.label);
    const [x, y] = it.at || [W() / 2, H() - 140];
    k.style.left = clamp(x, k.offsetWidth / 2 + 8, W() - k.offsetWidth / 2 - 8) + 'px';
    k.style.top = clamp(y, k.offsetHeight / 2 + 8, H() - k.offsetHeight / 2 - 8) + 'px';
  },

  scroll(it, g, box) {
    const [x, y] = it.at;
    const s = div('scroll ' + it.direction, box);
    Object.assign(s.style, { left: x + 'px', top: y + 'px' });
    const m = div('mouse', s);
    div('wheel', m);
    const chev = el('svg', { class: 'chev', viewBox: '0 0 24 64' });
    for (let i = 0; i < 3; i++) el('path', { d: `M5,${30 + i * 10} L12,${36 + i * 10} L19,${30 + i * 10}` }, chev);
    chev.style.transform = `rotate(${{ down: 0, up: 180, left: 90, right: -90 }[it.direction]}deg)`;
    s.appendChild(chev);
    if (it.label) bubble(it.label, x + 22, y, 1, 0, box, 8);
  },

  html(it, g, box) {
    const [x, y, w, h] = it.rect || [0, 0, W(), H()];
    const f = document.createElement('iframe');
    f.className = 'html';
    f.setAttribute('sandbox', 'allow-scripts');
    Object.assign(f.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const m = it.map;
    const env = { color: it.color || ACCENT, width: w, height: h, sx: m.sx, sy: m.sy, ox: m.ox - x, oy: m.oy - y };
    const json = JSON.stringify(env).replace(/</g, '\\u003c');
    const prelude =
      '<!doctype html><meta charset="utf-8">' +
      '<style>html,body{margin:0;background:transparent;overflow:hidden;color-scheme:normal}</style>' +
      `<script>(function(){var t=${json};` +
      't.pt=function(x,y){return [x*t.sx+t.ox,y*t.sy+t.oy]};' +
      't.rect=function(x,y,w,h){var a=t.pt(x,y);return [a[0],a[1],w*t.sx,h*t.sy]};' +
      'window.TMA=t;})()</' +
      'script>';
    f.srcdoc = prelude + it.html;
    box.appendChild(f);
  },
};

function render(it) {
  const g = el('g', {}, svg);
  const box = div('', it.type === 'spotlight' ? under : layer);
  if (it.color) {
    g.style.setProperty('--c', it.color);
    box.style.setProperty('--c', it.color);
  }
  const entry = { g, box };
  live.push(entry);
  try {
    RENDER[it.type](it, g, box);
  } catch (e) {
    console.error('render failed', it.type, e);
  }
  if (it.ttl) timers.push(setTimeout(() => remove(entry), it.ttl));
}

function remove(entry) {
  entry.g.classList.add('gone');
  entry.box.classList.add('gone');
  setTimeout(() => {
    entry.g.remove();
    entry.box.remove();
  }, 220);
  live = live.filter((e) => e !== entry);
}

function clearAll() {
  timers.forEach(clearTimeout);
  timers = [];
  live = [];
  svg.replaceChildren();
  layer.replaceChildren();
  under.replaceChildren();
}

tma.on('overlay:scene', ({ items, keep }) => {
  if (!keep) clearAll();
  for (const it of items) {
    if (it.delay) timers.push(setTimeout(() => render(it), it.delay));
    else render(it);
  }
});

tma.on('overlay:clear', clearAll);
