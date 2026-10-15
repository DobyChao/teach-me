const $ = (s) => document.querySelector(s);
const base = $('#base');
const halo = $('#halo');
const ink = $('#ink');
const bctx = base.getContext('2d');
const hctx = halo.getContext('2d');
const ictx = ink.getContext('2d');
const text = $('#text');
const bar = $('#bar');
const sendBtn = $('#send');

const PEN = '#ff3b30';
const PEN_WIDTH = 4;

let mode = 'idle';
let sel = null;
let dragStart = null;
let strokes = [];
let cur = null;
let submitting = false;

const ratio = () => base.width / window.innerWidth || 1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const full = () => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });

function setMode(m) {
  mode = m;
  document.body.classList.remove('select', 'draw');
  document.body.classList.add(m);
  const hint = $('#hint');
  if (m === 'select') {
    hint.textContent = '拖出一个框，圈住你想问的地方 · 单击 = 整个屏幕 · Esc 取消';
    hint.style.display = '';
  } else {
    hint.textContent = '可以直接在画面上涂画，标出重点 · Enter 交给它 · Esc 取消';
    hint.style.display = sel && sel.y < 64 && sel.height > window.innerHeight * 0.5 ? 'none' : '';
  }
}

function reset() {
  for (const c of [hctx, ictx]) c.clearRect(0, 0, ink.width, ink.height);
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, base.width, base.height);
  strokes = [];
  cur = null;
  sel = null;
  dragStart = null;
  submitting = false;
  sendBtn.disabled = false;
  text.value = '';
  document.body.classList.remove('has-sel', 'selecting');
  setMode('select');
}

function drawBitmap({ bitmap, width, height }) {
  for (const c of [base, halo, ink]) {
    c.width = width;
    c.height = height;
  }
  let px = new Uint8ClampedArray(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
  const row = width * 4;
  if (px.length !== row * height) {
    const stride = Math.floor(px.length / height);
    const packed = new Uint8ClampedArray(row * height);
    for (let y = 0; y < height; y++) packed.set(px.subarray(y * stride, y * stride + row), y * row);
    px = packed;
  }
  for (let i = 0; i < px.length; i += 4) {
    const b = px[i];
    px[i] = px[i + 2];
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  bctx.putImageData(new ImageData(px, width, height), 0, 0);
}

// ---------- selection ----------

function rectFrom(a, b) {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}

function showSel(r) {
  const s = $('#sel');
  Object.assign(s.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
  const dim = $('#dim');
  const k = ratio();
  dim.textContent = `${Math.round(r.width * k)} × ${Math.round(r.height * k)}`;
  dim.style.top = r.y < 32 ? '6px' : '-28px';
  dim.style.left = r.y < 32 ? '6px' : '-4px';
}

function placeBar() {
  const bw = bar.offsetWidth;
  const bh = bar.offsetHeight;
  const x = clamp(sel.x + sel.width - bw, 8, window.innerWidth - bw - 8);
  let y = sel.y + sel.height + 12;
  if (y + bh > window.innerHeight - 8) y = sel.y - bh - 12;
  if (y < 8) y = sel.y + sel.height - bh - 14;
  bar.style.left = x + 'px';
  bar.style.top = clamp(y, 8, window.innerHeight - bh - 8) + 'px';
}

function commitSelection(r) {
  sel = r.width < 6 || r.height < 6 ? full() : r;
  showSel(sel);
  document.body.classList.remove('selecting');
  document.body.classList.add('has-sel');
  setMode('draw');
  placeBar();
  text.focus();
}

// ---------- ink ----------

function segment(a, b) {
  const k = ratio();
  const layers = [
    [hctx, (PEN_WIDTH + 4) * k, 'rgba(255,255,255,0.92)'],
    [ictx, PEN_WIDTH * k, PEN],
  ];
  for (const [ctx, w, color] of layers) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
}

function redraw() {
  for (const c of [hctx, ictx]) c.clearRect(0, 0, ink.width, ink.height);
  for (const s of strokes) s.forEach((p, i) => segment(s[i - 1] || p, p));
}

function undo() {
  if (!strokes.length) return;
  strokes.pop();
  redraw();
}

// ---------- pointer ----------

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('#bar') || submitting) return;
  e.preventDefault();
  document.documentElement.setPointerCapture(e.pointerId);
  if (mode === 'select') {
    dragStart = [e.clientX, e.clientY];
    document.body.classList.add('selecting');
    showSel(rectFrom(dragStart, dragStart));
  } else if (mode === 'draw') {
    const k = ratio();
    cur = [[e.clientX * k, e.clientY * k]];
    strokes.push(cur);
    segment(cur[0], cur[0]);
  }
});

window.addEventListener('pointermove', (e) => {
  if (dragStart) {
    showSel(rectFrom(dragStart, [e.clientX, e.clientY]));
  } else if (cur) {
    const k = ratio();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = [ev.clientX * k, ev.clientY * k];
      segment(cur[cur.length - 1], p);
      cur.push(p);
    }
  }
});

window.addEventListener('pointerup', (e) => {
  if (dragStart) {
    const r = rectFrom(dragStart, [e.clientX, e.clientY]);
    dragStart = null;
    commitSelection(r);
  }
  cur = null;
});

// ---------- submit ----------

async function submit() {
  if (submitting) return;
  if (!sel) {
    sel = full();
    showSel(sel);
  }
  submitting = true;
  sendBtn.disabled = true;
  try {
    const k = ratio();
    const x = clamp(Math.round(sel.x * k), 0, base.width - 1);
    const y = clamp(Math.round(sel.y * k), 0, base.height - 1);
    const w = clamp(Math.round(sel.width * k), 1, base.width - x);
    const h = clamp(Math.round(sel.height * k), 1, base.height - y);
    const out = new OffscreenCanvas(w, h);
    const ctx = out.getContext('2d');
    for (const src of [base, halo, ink]) ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
    const blob = await out.convertToBlob({ type: 'image/png' });
    const png = new Uint8Array(await blob.arrayBuffer());
    const marks = strokes.filter((s) => s.some(([px, py]) => px >= x && py >= y && px <= x + w && py <= y + h)).length;
    const r = await tma.invoke('freeze:submit', {
      selection: { x: sel.x, y: sel.y, width: sel.width, height: sel.height },
      png,
      text: text.value.trim(),
      strokes: marks,
    });
    if (!r || !r.ok) throw new Error((r && r.error) || 'submit failed');
  } catch (err) {
    console.error(err);
    submitting = false;
    sendBtn.disabled = false;
  }
}

function cancel() {
  tma.send('freeze:cancel');
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancel();
  } else if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    submit();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    if (document.activeElement === text && text.value) return;
    e.preventDefault();
    undo();
  }
});

$('#undo').addEventListener('click', undo);
$('#reselect').addEventListener('click', () => {
  sel = null;
  document.body.classList.remove('has-sel');
  setMode('select');
});
$('#cancel').addEventListener('click', cancel);
$('#send').addEventListener('click', submit);
$('#mic').addEventListener('click', () => {
  text.focus();
  tma.send('voice:dictate');
});

tma.on('freeze:start', (d) => {
  reset();
  drawBitmap(d);
  text.value = d.draft || '';
  tma.send('freeze:ready');
});

tma.on('freeze:reset', reset);

reset();
