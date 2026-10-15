const $ = (s) => document.querySelector(s);
const log = $('#log');
const input = $('#input');
const sendBtn = $('#btn-send');
const attachBtn = $('#btn-attach');

let hotkeys = {};
let attach = localStorage.getItem('attach') !== 'off';
let collapsed = false;
let ended = false;
let sending = false;
let endArmTimer = null;
let state = { agent: 'offline', since: Date.now(), pending: 0 };

// ---------- rendering ----------

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function md(text) {
  return esc(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\[\[([^\]\n]+)\]\]/g, '<kbd>$1</kbd>')
    .replace(/^(\s*)[-*] /gm, '$1• ');
}

function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fileUrl(p) {
  return encodeURI('file:///' + p.replace(/\\/g, '/')).replace(/#/g, '%23');
}

function scrollDown() {
  log.scrollTop = log.scrollHeight;
}

function hideEmpty() {
  const e = $('#empty');
  if (e) e.style.display = 'none';
}

function addAgent(entry, quiet) {
  hideEmpty();
  const m = document.createElement('div');
  m.className = 'msg agent';
  m.innerHTML = md(entry.text) + `<span class="meta">${hhmm(entry.at)}</span>`;
  log.appendChild(m);
  $('#last').innerHTML = md(entry.text);
  scrollDown();
  if (!quiet) flash();
}

function addUser(entry) {
  hideEmpty();
  const m = document.createElement('div');
  m.className = 'msg user';
  m.innerHTML = entry.text ? md(entry.text) : '<span style="color:var(--muted)">（只发了画面）</span>';
  if (entry.shots && entry.shots.length) {
    const t = document.createElement('div');
    t.className = 'thumbs';
    for (const s of entry.shots.slice(0, 2)) {
      const img = document.createElement('img');
      img.src = fileUrl(s.path);
      img.title = s.role;
      t.appendChild(img);
    }
    m.appendChild(t);
  }
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = hhmm(entry.at);
  m.appendChild(meta);
  log.appendChild(m);
  scrollDown();
}

function addNotice(entry, warn) {
  const n = document.createElement('div');
  n.className = 'notice' + (warn ? ' warn' : '');
  n.textContent = entry.text;
  log.appendChild(n);
  scrollDown();
}

function renderHistory(history) {
  log.querySelectorAll('.msg, .notice').forEach((n) => n.remove());
  $('#last').textContent = '';
  const e = $('#empty');
  if (e) e.style.display = history.length ? 'none' : '';
  for (const h of history) {
    if (h.kind === 'agent') addAgent(h, true);
    else if (h.kind === 'user') addUser(h);
    else addNotice(h);
  }
}

function flash() {
  const h = $('#header');
  h.classList.remove('flash');
  void h.offsetWidth;
  h.classList.add('flash');
}

function elapsed(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

function renderState() {
  const { agent, since, pending } = state;
  const text = {
    listening: 'agent 在听 · 说一句，或圈给它看',
    thinking: `agent 在想… ${elapsed(Date.now() - since)}`,
    offline: pending
      ? `agent 暂时没在听 · ${pending} 条消息排队中，它回来就会看到`
      : 'agent 没在听 · 先在你的 agent 里开始一次教学',
    ended: '这次教学已结束',
  }[agent];
  $('#status-text').textContent = text || agent;
  $('#status').className = agent;
  $('#dot').className = 'dot ' + agent;
  ended = agent === 'ended';
  $('#btn-end').title = ended ? '关闭' : '结束这次教学';
}

function setSession(s) {
  $('#topic').textContent = s.topic || '';
  $('#topic').title = s.topic || '';
}

function setOverlayHidden(hidden) {
  $('#btn-eye').classList.toggle('hidden-guides', !!hidden);
  $('#btn-eye').title = hidden ? '显示画面上的指引' : '隐藏画面上的指引';
}

function setHotkeys(hk) {
  hotkeys = hk || {};
  const pretty = (a) => (a || '').replace(/Control/g, 'Ctrl').replace(/CommandOrControl/g, 'Ctrl');
  document.querySelectorAll('[data-hk]').forEach((k) => {
    k.textContent = pretty(hotkeys[k.dataset.hk]) || '未设置';
  });
  $('#btn-draw').title = `圈给它看（${pretty(hotkeys.freeze)}）`;
}

function renderAttach() {
  attachBtn.classList.toggle('on', attach);
  attachBtn.title = attach ? '发送时会附上当前屏幕（点一下关闭）' : '发送时不附屏幕（点一下打开）';
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  if (collapsed) requestCollapse();
}

function requestCollapse() {
  const h = $('#header').offsetHeight + $('#last').offsetHeight + $('#composer').offsetHeight + 28;
  tma.send('panel:collapse', { collapsed, height: h });
}

// ---------- actions ----------

async function send() {
  const text = input.value.trim();
  if (!text || sending) return;
  sending = true;
  sendBtn.disabled = true;
  input.value = '';
  autosize();
  tma.send('panel:draft', '');
  try {
    const r = await tma.invoke('panel:send', { text, attach });
    if (!r || !r.ok) input.value = text;
  } catch {
    input.value = text;
  } finally {
    sending = false;
    sendBtn.disabled = false;
    autosize();
  }
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    send();
  } else if (e.key === 'Escape') {
    tma.send('panel:escape');
  }
});

input.addEventListener('input', () => {
  autosize();
  tma.send('panel:draft', input.value);
});

sendBtn.addEventListener('click', send);

attachBtn.addEventListener('click', () => {
  attach = !attach;
  localStorage.setItem('attach', attach ? 'on' : 'off');
  renderAttach();
});

$('#btn-mic').addEventListener('click', () => {
  input.focus();
  tma.send('voice:dictate');
});

$('#btn-draw').addEventListener('click', () => tma.send('panel:freeze'));
$('#btn-clear').addEventListener('click', () => tma.send('panel:clear-overlay'));
$('#btn-eye').addEventListener('click', () => tma.send('panel:toggle-overlay'));

$('#btn-collapse').addEventListener('click', () => {
  collapsed = !collapsed;
  document.body.classList.toggle('collapsed', collapsed);
  $('#btn-collapse').title = collapsed ? '展开' : '折叠';
  requestAnimationFrame(requestCollapse);
});

$('#btn-end').addEventListener('click', () => {
  const b = $('#btn-end');
  if (ended) return tma.send('panel:quit');
  if (!b.classList.contains('armed')) {
    b.classList.add('armed');
    clearTimeout(endArmTimer);
    endArmTimer = setTimeout(() => b.classList.remove('armed'), 3000);
    return;
  }
  b.classList.remove('armed');
  tma.send('panel:end');
});

// ---------- events from main ----------

tma.on('panel:init', (d) => {
  setSession(d.session);
  setHotkeys(d.hotkeys);
  renderHistory(d.history || []);
  setOverlayHidden(d.overlayHidden);
  for (const err of d.hotkeyErrors || []) addNotice({ text: err }, true);
});

tma.on('panel:session', (d) => {
  setSession(d.session);
  renderHistory(d.history || []);
});

tma.on('panel:say', (e) => addAgent(e));
tma.on('panel:user', (e) => addUser(e));
tma.on('panel:notice', (e) => addNotice(e, true));
tma.on('panel:overlay-hidden', setOverlayHidden);
tma.on('panel:state', (s) => {
  state = s;
  renderState();
});
tma.on('panel:focus-input', () => {
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});
tma.on('panel:clear-draft', () => {
  input.value = '';
  autosize();
});

setInterval(() => state.agent === 'thinking' && renderState(), 1000);
renderAttach();
renderState();
