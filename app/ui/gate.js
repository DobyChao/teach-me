const consent = document.getElementById('consent');
const displays = document.getElementById('displays');
const list = document.getElementById('list');
let picked = null;
let timer = null;

function choose(payload) {
  if (timer) clearInterval(timer);
  tma.send('gate:choice', payload);
}

document.getElementById('allow').addEventListener('click', () => choose({ decision: 'allow' }));
document.getElementById('deny').addEventListener('click', () => choose({ decision: 'deny' }));
document.getElementById('cancel').addEventListener('click', () => choose({ decision: 'cancel' }));
document.getElementById('end').addEventListener('click', () => choose({ decision: 'end' }));
document.getElementById('use').addEventListener('click', () => {
  if (picked == null) return;
  choose({ decision: 'pick', displayId: picked });
});

tma.on('gate:open', (d) => {
  if (timer) clearInterval(timer);
  picked = null;
  if (d.kind === 'display') {
    consent.hidden = true;
    displays.hidden = false;
    document.getElementById('display-title').textContent = d.title || '在哪块屏幕上教学';
    document.getElementById('end').hidden = !d.allowEnd;
    list.replaceChildren();
    const usable = (d.displays || []).filter((x) => x.supported);
    picked = usable.length ? usable[0].id : null;
    for (const item of d.displays || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card' + (item.id === picked ? ' on' : '');
      b.disabled = !item.supported;
      const bounds = item.bounds ? `${item.bounds.width}×${item.bounds.height}` : '—';
      const scale = item.scaleFactor ? ` · ${item.scaleFactor}x` : '';
      b.textContent = item.supported ? `屏幕 ${item.id} · ${bounds}${scale}` : `屏幕 ${item.id} · 不支持`;
      b.addEventListener('click', () => {
        picked = item.id;
        for (const n of list.children) n.classList.remove('on');
        b.classList.add('on');
      });
      list.appendChild(b);
    }
    return;
  }
  displays.hidden = true;
  consent.hidden = false;
  document.getElementById('title').textContent = d.title || '允许连接？';
  document.getElementById('copy').textContent = d.body || '';
  document.getElementById('sid').textContent = d.sessionId ? `会话 ${d.sessionId}` : '';
  const count = document.getElementById('count');
  if (d.emphasizeDefault && d.timeoutMs) {
    let left = Math.ceil(d.timeoutMs / 1000);
    const tick = () => {
      count.textContent = `${left} 秒后自动拒绝`;
    };
    tick();
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) clearInterval(timer);
      else tick();
    }, 1000);
  } else count.textContent = '';
});
