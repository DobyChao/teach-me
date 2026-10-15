const $ = (s) => document.querySelector(s);
const log = $('#log');
let hotkeys = {};
let ended = false;
let state = { agent: 'offline', since: Date.now(), pending: 0 };
let rec = null;
let recorder = null;
let stream = null;
let chunks = [];
let voiceText = '';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function md(text) {
  return esc(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\[\[([^\]\n]+)\]\]/g, '<kbd>$1</kbd>');
}
function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fileUrl(p) {
  return encodeURI('file:///' + String(p).replace(/\\/g, '/')).replace(/#/g, '%23');
}
function hideEmpty() {
  const e = $('#empty');
  if (e) e.style.display = 'none';
}
function addAgent(entry) {
  hideEmpty();
  const m = document.createElement('div');
  m.className = 'msg agent';
  m.innerHTML = md(entry.text) + `<span class="meta">${hhmm(entry.at)}</span>`;
  log.appendChild(m);
  $('#last').textContent = entry.text;
  log.scrollTop = log.scrollHeight;
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
      img.alt = s.role || '';
      t.appendChild(img);
    }
    m.appendChild(t);
  }
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = hhmm(entry.at);
  m.appendChild(meta);
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
}
function addNotice(entry) {
  const n = document.createElement('div');
  n.className = 'notice';
  n.textContent = entry.text;
  log.appendChild(n);
}
function renderHistory(history) {
  log.querySelectorAll('.msg, .notice').forEach((n) => n.remove());
  const e = $('#empty');
  if (e) e.style.display = history && history.length ? 'none' : '';
  $('#last').textContent = '还没有开始。按住说话，点一下打字。';
  for (const h of history || []) {
    if (h.kind === 'agent') addAgent(h);
    else if (h.kind === 'user') addUser(h);
    else addNotice(h);
  }
}
function elapsed(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}
function renderState() {
  const { agent, since, pending } = state;
  const text = {
    listening: 'agent 在听',
    thinking: `agent 在想… ${elapsed(Date.now() - since)}`,
    offline: pending ? `agent 不在 · ${pending} 条在排队` : 'agent 还没连上',
    ended: '这次教学已结束',
  }[agent] || '还没有教学';
  $('#status-text').textContent = text;
  $('#dot').className = 'dot ' + (agent || 'offline');
  document.body.classList.toggle('listening', agent === 'listening');
  document.body.classList.toggle('thinking', agent === 'thinking');
  document.body.classList.toggle('offline', agent === 'offline' || !agent);
  ended = agent === 'ended';
}
function applyConfig(cfg) {
  if (!cfg) return;
  const mode = cfg.appearance && cfg.appearance.mode === 'pet' ? 'pet' : 'capsule';
  document.body.classList.toggle('mode-pet', mode === 'pet');
  document.body.classList.toggle('mode-capsule', mode !== 'pet');
  hotkeys = cfg.hotkeys || hotkeys;
}
function setSession(s) {
  $('#sid').textContent = s && s.id ? s.id : '';
  $('#sid').title = s && s.id ? s.id : '';
}
function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}
async function startListen(engine) {
  voiceText = '';
  if (engine === 'system') {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      tma.send('voice:result', { error: 'no-system-speech' });
      return;
    }
    rec = new Rec();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      voiceText = '';
      for (let i = 0; i < e.results.length; i++) voiceText += e.results[i][0].transcript;
      $('#last').textContent = voiceText || '在听…';
    };
    rec.onerror = () => {};
    rec.onend = () => {
      const text = voiceText;
      rec = null;
      tma.send('voice:result', { text });
    };
    try {
      rec.start();
    } catch (e) {
      rec = null;
      tma.send('voice:result', { error: e.message || 'speech-failed' });
    }
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const data = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const mime = blob.type;
      recorder = null;
      stopStream();
      tma.send('voice:audio', { mime, data });
    };
    recorder.start();
  } catch (e) {
    stopStream();
    tma.send('voice:result', { error: e.message || 'mic-denied' });
  }
}
function stopListen() {
  if (rec) {
    try {
      rec.stop();
    } catch {
      rec = null;
      tma.send('voice:result', { text: voiceText || '' });
    }
  }
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop();
    } catch {
      recorder = null;
      stopStream();
      tma.send('voice:result', { error: 'record-failed' });
    }
  }
}

const entry = $('#entry');
entry.addEventListener('pointerdown', (e) => {
  entry.classList.add('holding');
  try {
    entry.setPointerCapture(e.pointerId);
  } catch {}
  tma.send('input:pointer', { phase: 'down' });
});
function pointerUp() {
  if (!entry.classList.contains('holding')) return;
  entry.classList.remove('holding');
  tma.send('input:pointer', { phase: 'up' });
}
entry.addEventListener('pointerup', pointerUp);
entry.addEventListener('pointercancel', pointerUp);

$('#btn-continue').addEventListener('click', () => tma.send('panel:continue'));
$('#btn-board').addEventListener('click', () => tma.send('panel:board-edit'));
$('#btn-eye').addEventListener('click', () => tma.send('panel:toggle-overlay'));
$('#btn-expand').addEventListener('click', () => tma.send('panel:toggle-expand'));
$('#btn-clear-user').addEventListener('click', () => tma.send('panel:clear-user'));
$('#btn-clear-agent').addEventListener('click', () => tma.send('panel:clear-agent'));
$('#btn-settings').addEventListener('click', () => tma.send('panel:settings'));
$('#btn-copy-id').addEventListener('click', () => tma.send('panel:copy-id'));
$('#btn-end').addEventListener('click', () => tma.send(ended ? 'panel:quit' : 'panel:end'));
$('#tour-next').addEventListener('click', () => tma.send('tour:next'));
$('#tour-skip').addEventListener('click', () => tma.send('tour:skip'));
$('#flash-undo').addEventListener('click', () => tma.send('panel:voice-undo'));
$('#attach-board').addEventListener('change', (e) => tma.send('panel:attach-board', { on: e.target.checked }));

document.body.addEventListener('mouseenter', () => tma.send('panel:hover', { on: true }));
document.body.addEventListener('mouseleave', () => tma.send('panel:hover', { on: false }));

tma.on('panel:init', (d) => {
  applyConfig(d.config);
  setSession(d.session);
  renderHistory(d.history || []);
  if (d.hotkeyErrors) for (const err of d.hotkeyErrors) addNotice({ text: err });
  document.body.classList.toggle('collapsed', d.collapsed !== false);
  $('#btn-expand').textContent = d.collapsed === false ? '收起' : '展开';
  $('#btn-eye').classList.toggle('hidden-guides', !!d.overlayHidden);
  $('#btn-board').classList.toggle('on', !!d.editing);
  const board = d.board || {};
  $('#attach-board').checked = !!board.attach;
  $('#attach-board').disabled = !board.hasContent;
});
tma.on('panel:config', applyConfig);
tma.on('panel:session', (d) => {
  setSession(d.session);
  if (d.history) renderHistory(d.history);
});
tma.on('panel:say', addAgent);
tma.on('panel:user', addUser);
tma.on('panel:notice', addNotice);
tma.on('panel:state', (s) => {
  state = s;
  renderState();
});
tma.on('panel:overlay-hidden', (hidden) => {
  $('#btn-eye').classList.toggle('hidden-guides', !!hidden);
  $('#btn-eye').textContent = hidden ? '显示指引' : '指引';
});
tma.on('panel:collapsed', (collapsed) => {
  document.body.classList.toggle('collapsed', !!collapsed);
  $('#btn-expand').textContent = collapsed ? '展开' : '收起';
});
tma.on('panel:editing', (on) => {
  document.body.classList.toggle('editing', !!on);
});
tma.on('panel:board', (board) => {
  const box = $('#attach-board');
  box.disabled = !board.hasContent;
  box.checked = !!board.attach;
});
tma.on('panel:listen', (d) => {
  if (d && d.on) {
    $('#last').textContent = '在听…';
    startListen(d.engine || 'system');
  } else stopListen();
});
tma.on('panel:voice-flash', (d) => {
  const flash = $('#flash');
  if (!d || !d.text) {
    flash.hidden = true;
    return;
  }
  $('#flash-text').textContent = d.text;
  flash.hidden = false;
});
tma.on('panel:tour', (d) => {
  const bar = $('#tourbar');
  if (!d || !d.on) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  $('#tour-label').textContent = `引导 ${d.step}/${d.total}`;
});
tma.on('panel:speak', (d) => {
  if (!d || !d.text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(d.text));
});

setInterval(() => state.agent === 'thinking' && renderState(), 1000);
renderState();
