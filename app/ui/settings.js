const HOTKEYS = [
  ['talk', '输入（按住说话 / 点一下打字）'],
  ['toggleOverlay', '隐藏 / 显示指引'],
  ['continue', '继续'],
  ['boardEdit', '画板编辑'],
  ['captureAllow', '截屏审批'],
];

const hotkeys = {};
let recording = null;

function field(id) {
  return document.getElementById(id);
}

function renderHotkeys() {
  const root = field('hotkeys');
  root.replaceChildren();
  for (const [name, label] of HOTKEYS) {
    const row = document.createElement('label');
    row.append(document.createTextNode(label));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hk';
    btn.textContent = hotkeys[name] || '未绑定';
    btn.addEventListener('click', () => {
      recording = name;
      btn.textContent = '请按键…';
    });
    btn.dataset.hk = name;
    row.append(btn);
    root.append(row);
  }
}

window.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === 'Escape') {
    recording = null;
    renderHotkeys();
    return;
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    hotkeys[recording] = '';
    recording = null;
    renderHotkeys();
    return;
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  if (!(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) return;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  hotkeys[recording] = parts.join('+');
  recording = null;
  renderHotkeys();
});

function fill(cfg) {
  const c = cfg || {};
  Object.assign(hotkeys, (c.hotkeys || {}));
  renderHotkeys();
  field('attach-shot').checked = c.attachScreenshot !== false;
  field('engine').value = (c.voice && c.voice.engine) || 'system';
  field('local').value = (c.voice && c.voice.localCommand) || '';
  field('custom').value = (c.voice && c.voice.customUrl) || '';
  field('tts').value = (c.voice && c.voice.tts) || 'off';
  field('confirm').value = (c.voice && c.voice.confirmMs) || 1500;
  field('tier').value = (c.capture && c.capture.tier) || 'ask';
  field('mode').value = (c.appearance && c.appearance.mode) || 'capsule';
  field('collapse').value = c.appearance && c.appearance.autoCollapseSec != null ? c.appearance.autoCollapseSec : 8;
}

field('save').addEventListener('click', () => {
  tma.send('settings:save', {
    hotkeys: { ...hotkeys },
    attachScreenshot: field('attach-shot').checked,
    voice: {
      engine: field('engine').value,
      localCommand: field('local').value.trim(),
      customUrl: field('custom').value.trim(),
      tts: field('tts').value,
      confirmMs: Number(field('confirm').value) || 1500,
    },
    capture: { tier: field('tier').value },
    appearance: {
      mode: field('mode').value,
      autoCollapseSec: Math.max(0, Number(field('collapse').value) || 0),
    },
  });
});
field('tour').addEventListener('click', () => tma.send('settings:tour'));

tma.on('settings:init', (d) => {
  fill(d && d.config);
  field('err').textContent = d && d.hotkeyErrors && d.hotkeyErrors.length ? d.hotkeyErrors.join(' ') : '';
});
tma.on('settings:saved', (d) => {
  field('err').textContent = d && d.hotkeyErrors && d.hotkeyErrors.length ? d.hotkeyErrors.join(' ') : '已保存';
  if (d && d.config) fill(d.config);
});
