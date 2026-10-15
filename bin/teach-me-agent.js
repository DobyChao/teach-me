#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const P = require('../lib/paths');

const ROOT = path.join(__dirname, '..');
const CLI_PATH = path.join(ROOT, 'bin', 'teach-me-agent.js').replace(/\\/g, '/');
const BOOLEAN_FLAGS = new Set(['json', 'keep', 'help']);

const HELP = `Teach me, Agent — on-screen teaching overlay driven by your coding agent.

Usage: teach-me-agent <command> [options]

  start [--topic T] [--say S]   Launch the overlay + panel (if needed) and begin a session
  wait [--timeout SEC]          Block until the user speaks or circles something (default 480s)
  say <text> | --file F | -     Show text in the user's panel
  show <scene.json | JSON | ->  Draw guides on screen (arrows, boxes, clicks, html...) [--say S] [--shot ID] [--keep]
  clear                         Remove everything drawn
  zoom --rect x,y,w,h [--shot]  Crop a sharper image out of an existing shot (no new screenshot)
  status                        Session, agent state, recent shots
  stop                          Close the app
  demo                          Draw a sample of every guide type on the primary screen
  install-skill [--to DIR]      Install the agent skill (Cursor, plus Claude Code / Codex if present)

Scene reference: ${path.join(ROOT, 'skill', 'teach-me-agent', 'scene-reference.md')}
`;

// ---------- plumbing ----------

function out(s) {
  process.stdout.write(s.endsWith('\n') ? s : s + '\n');
}

function fail(msg) {
  process.stderr.write(`teach-me-agent: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[key] = a.slice(eq + 1);
      else if (BOOLEAN_FLAGS.has(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) flags[key] = true;
      else flags[key] = argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, route, body) {
  const st = P.readState();
  if (!st) return Promise.reject(Object.assign(new Error('Teach me, Agent is not running'), { code: 'NOT_RUNNING' }));
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = { 'x-tma-token': st.token };
    if (data) Object.assign(headers, { 'content-type': 'application/json', 'content-length': data.length });
    const req = http.request({ host: '127.0.0.1', port: st.port, path: route, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {}
        if (res.statusCode >= 400) reject(Object.assign(new Error(json.error || `HTTP ${res.statusCode}`), { code: 'APP_ERROR' }));
        else resolve(json);
      });
      res.on('error', (e) => reject(Object.assign(e, { code: 'GONE' })));
    });
    req.on('error', (e) => {
      const code = e.code === 'ECONNREFUSED' ? 'NOT_RUNNING' : e.code === 'ECONNRESET' ? 'GONE' : e.code;
      reject(Object.assign(e, { code }));
    });
    if (data) req.write(data);
    req.end();
  });
}

async function call(method, route, body) {
  try {
    return await request(method, route, body);
  } catch (e) {
    if (e.code === 'NOT_RUNNING' || e.code === 'GONE')
      fail('Teach me, Agent is not running. Start a session with: teach-me-agent start --topic "..."');
    fail(e.message);
  }
}

async function ensureApp() {
  try {
    return await request('GET', '/health');
  } catch (e) {
    if (e.code === 'APP_ERROR') throw e;
  }
  let electron;
  try {
    electron = require('electron');
  } catch {
    fail(`Electron is not installed. Run \`npm install\` in ${ROOT}`);
  }
  try {
    fs.unlinkSync(P.stateFile);
  } catch {}
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [ROOT], { detached: true, stdio: 'ignore', env });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    await sleep(300);
    try {
      return await request('GET', '/health');
    } catch {}
  }
  fail(`the app did not come up within 25s; see ${P.logFile}`);
}

function pretty(acc) {
  return String(acc || '').replace(/CommandOrControl|Control/g, 'Ctrl');
}

function hhmmss(iso) {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

// ---------- commands ----------

async function cmdStart({ pos, flags }) {
  const topic = typeof flags.topic === 'string' ? flags.topic : pos.join(' ');
  await ensureApp();
  const r = await call('POST', '/session', { topic, say: typeof flags.say === 'string' ? flags.say : undefined });
  const hk = r.hotkeys;
  const lines = [
    `Teach me, Agent is running. Session ${r.session.id}${topic ? ` — "${topic}"` : ''}.`,
    `The user's panel is on screen. Their hotkeys: ${pretty(hk.talk)} talk · ${pretty(hk.freeze)} circle-to-ask · ${pretty(hk.toggleOverlay)} hide/show your guides.`,
    `Session dir (transcript.jsonl, shots/): ${r.session.dir}`,
    `Scratch dir for scene / html files: ${r.session.scratch}`,
  ];
  if (r.hotkeyErrors && r.hotkeyErrors.length) lines.push('Hotkey problems (tell the user): ' + r.hotkeyErrors.join('; '));
  lines.push('', 'Next: optionally greet in one short line with `say`, then run `wait` (tool timeout >= 10 min) and keep looping.');
  out(lines.join('\n'));
}

function describeSource(m) {
  if (m.source !== 'freeze') return 'typed in the panel';
  const roles = m.shots.map((s) => s.role);
  if (roles.includes('annotated')) return 'froze the screen, boxed a region and drew on it';
  if (roles.includes('context')) return 'froze the screen and boxed a region';
  return 'froze the whole screen';
}

function formatWait(r, timeout) {
  if (r.timeout)
    return `NO_MESSAGE — the user has not said anything in ${timeout}s. That is normal; just run \`wait\` again (do not message the user about it).`;
  if (r.superseded) return 'SUPERSEDED — another `wait` call took over this one. Keep exactly one `wait` running at a time.';
  if (r.aborted) return 'ABORTED — the wait was interrupted. Run `wait` again.';
  if (r.closed) return `SESSION_CLOSED — ${r.reason || 'the session is over'}. Stop looping and give the user a short recap in chat.`;

  const msgs = r.messages || [];
  const real = msgs.filter((m) => m.kind === 'message');
  const ended = msgs.some((m) => m.kind === 'end');
  const lines = [];
  if (real.length) lines.push(real.length === 1 ? 'The user sent a message.' : `The user sent ${real.length} messages (oldest first).`);
  for (const m of real) {
    lines.push('', `#${m.id} at ${hhmmss(m.at)} — ${describeSource(m)}`);
    lines.push(m.text ? `User: ${m.text}` : 'User: (no words, only the image)');
    for (const s of m.shots) lines.push(`  ${s.id}  ${s.width}x${s.height}  ${s.note}`, `      ${s.path}`);
  }
  if (real.some((m) => m.shots.length)) {
    lines.push('', 'Open the image(s) with your image/file reading tool before answering.');
    if (r.defaultShot)
      lines.push(`Scene coordinates default to the pixels of ${r.defaultShot}; set "shot" on the scene or an item to use another image.`);
  } else if (real.length) lines.push('', 'No screen image this time (the user turned it off). Answer from context, or ask them to circle it.');
  if (r.scene) lines.push(`Still drawn from before: scene #${r.scene.id} (${r.scene.types.join(', ')}). A new \`show\` replaces it.`);
  if (r.overlayHidden) lines.push('The user has hidden your guides right now; they will see drawings again when they unhide.');
  if (ended)
    lines.push('', 'END — the user clicked "end lesson". Do not run `wait` again. Run `stop`, then give a short recap in chat.');
  else lines.push('', 'Next: reply with `show` (draw + "say") or `say`, then run `wait` again.');
  return lines.join('\n').trim();
}

async function cmdWait({ flags }) {
  const timeout = Math.max(1, Number(flags.timeout) || 480);
  let r;
  try {
    r = await request('GET', `/wait?timeout=${timeout}`);
  } catch (e) {
    if (e.code === 'NOT_RUNNING' || e.code === 'GONE')
      return out('SESSION_CLOSED — the Teach me, Agent app is not running (the user closed it, or it was stopped). Stop looping and recap in chat.');
    fail(e.message);
  }
  out(flags.json ? JSON.stringify(r, null, 2) : formatWait(r, timeout));
  if (r.messages && r.messages.length) await call('POST', '/ack', { id: r.messages[r.messages.length - 1].id });
}

async function textArg({ pos, flags }) {
  if (typeof flags.file === 'string') return fs.readFileSync(flags.file, 'utf8');
  if (pos[0] === '-') return readStdin();
  return pos.join(' ');
}

async function cmdSay(args) {
  const text = (await textArg(args)).replace(/^\uFEFF/, '');
  if (!text.trim()) fail('say needs text: teach-me-agent say "..."');
  await call('POST', '/say', { text });
  out('Shown in the panel. Run `wait` when you are ready to hear back.');
}

function parseScene(raw) {
  const s = raw.replace(/^\uFEFF/, '').trim();
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? { items: v } : v;
  } catch (e) {
    const stripped = /^[{[]\s*\{?\s*[A-Za-z_]+\s*:/.test(s) ? ' It looks like your shell stripped the double quotes.' : '';
    fail(`scene is not valid JSON (${e.message}).${stripped} Write the JSON to a file and run: teach-me-agent show <file>`);
  }
}

async function cmdShow({ pos, flags }) {
  const src = pos.join(' ').trim();
  if (!src) fail('show needs a scene: a JSON file path, inline JSON, or - for stdin');
  let raw;
  if (src === '-') raw = await readStdin();
  else if (src.startsWith('{') || src.startsWith('[')) raw = src;
  else {
    try {
      raw = fs.readFileSync(path.resolve(src), 'utf8');
    } catch (e) {
      fail(`cannot read scene file ${src}: ${e.message}`);
    }
  }
  const scene = parseScene(raw);
  if (typeof flags.shot === 'string') scene.shot = flags.shot;
  if (typeof flags.say === 'string') scene.say = flags.say;
  if (flags.keep) scene.keep = true;
  const r = await call('POST', '/show', { scene });
  const lines = [];
  if (r.drawn.length)
    lines.push(`Drew scene #${r.id}: ${r.drawn.join(', ')}${r.shots.length ? ` (coordinates from ${r.shots.join(', ')})` : ''}.`);
  else lines.push(Array.isArray(scene.items) ? 'Nothing drawn.' : 'Nothing drawn (no items).');
  if (scene.say) lines.push('Text shown in the panel.');
  if (r.warnings.length) lines.push('Warnings:', ...r.warnings.map((w) => '  - ' + w));
  if (r.overlayHidden) lines.push('The user has hidden guides right now, so they will not see this until they unhide.');
  lines.push('Run `wait` to hear back.');
  out(lines.join('\n'));
}

async function cmdClear() {
  await call('POST', '/clear');
  out('Cleared all guides.');
}

async function cmdZoom({ pos, flags }) {
  const nums = [typeof flags.rect === 'string' ? flags.rect : '', ...pos].join(',').split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n)))
    fail('zoom needs a rect: teach-me-agent zoom --rect x,y,w,h [--shot s3]');
  const r = await call('POST', '/zoom', { shot: typeof flags.shot === 'string' ? flags.shot : undefined, rect: nums });
  const s = r.shot;
  out(
    [
      `${s.id}  ${s.width}x${s.height}  ${s.note}`,
      `    ${s.path}`,
      `Open it; to point at something in it, set "shot": "${s.id}" on the scene or item.`,
    ].join('\n'),
  );
}

async function cmdStatus({ flags }) {
  let r;
  try {
    r = await request('GET', '/status');
  } catch (e) {
    return out('Not running.');
  }
  if (flags.json) return out(JSON.stringify(r, null, 2));
  const lines = [
    `Teach me, Agent ${r.version} — session ${r.session.id}${r.session.topic ? ` — "${r.session.topic}"` : ''}`,
    `Agent state as the user sees it: ${r.agent}; queued messages: ${r.pending}`,
    `Drawn now: ${r.scene ? `scene #${r.scene.id} (${r.scene.types.join(', ')})` : 'nothing'}${r.overlayHidden ? ' — hidden by the user' : ''}`,
    `Default shot: ${r.defaultShot || 'none yet'}`,
    `Scratch dir: ${r.session.scratch}`,
  ];
  if (r.recentShots.length) lines.push('Recent shots:', ...r.recentShots.map((s) => `  ${s.id}  ${s.width}x${s.height}  ${s.role}  ${s.path}`));
  if (r.hotkeyErrors.length) lines.push('Hotkey problems: ' + r.hotkeyErrors.join('; '));
  out(lines.join('\n'));
}

async function cmdStop() {
  try {
    await request('POST', '/stop');
    out('Stopped. The overlay and panel are closed.');
  } catch {
    out('Not running.');
  }
}

async function cmdDemo() {
  await ensureApp();
  const st = await call('GET', '/status');
  const d = st.displays.find((x) => x.id === st.primaryDisplay) || st.displays[0];
  const W = d.bounds.width;
  const H = d.bounds.height;
  const at = (fx, fy) => [Math.round(W * fx), Math.round(H * fy)];
  const html = `<style>
  .card{position:absolute;inset:0;border-radius:14px;background:rgba(20,22,29,.94);box-shadow:0 0 0 1.5px ${'#ff3d7f'};color:#fff;font:14px 'Segoe UI','Microsoft YaHei UI';padding:14px 16px;box-sizing:border-box;overflow:hidden}
  .bar{height:10px;border-radius:5px;background:#2b2f39;margin-top:12px;overflow:hidden}
  .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ff3d7f,#ffb36b);animation:fill 2.4s ease-in-out infinite}
  @keyframes fill{60%,100%{width:100%}}
  .dots span{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff3d7f;margin-right:6px;animation:b 1s infinite}
  .dots span:nth-child(2){animation-delay:.15s}.dots span:nth-child(3){animation-delay:.3s}
  @keyframes b{50%{transform:translateY(-6px)}}
</style>
<div class="card"><div>这是一段 agent 自己写的 HTML 动画</div><div class="bar"><i></i></div><div style="margin-top:12px" class="dots"><span></span><span></span><span></span></div></div>`;
  const scene = {
    shot: 'screen',
    say: '这是演示：**箭头**、**方框**、**点击**、**拖动**、**步骤编号**、**快捷键**、**滚动**，以及 agent 可以随手写的 HTML 动画。\n按 [[Ctrl+Alt+H]] 隐藏，或点面板上的橡皮擦清除。',
    items: [
      { type: 'step', at: at(0.1, 0.18), n: 1, label: '步骤编号' },
      { type: 'box', rect: [...at(0.08, 0.3), Math.round(W * 0.2), 64], label: '方框：看这一块', delay: 250 },
      { type: 'arrow', to: at(0.5, 0.42), label: '箭头指着这里', delay: 500 },
      { type: 'click', at: at(0.72, 0.24), label: '点这里', delay: 750 },
      { type: 'click', at: at(0.86, 0.24), button: 'right', delay: 850 },
      { type: 'drag', from: at(0.6, 0.58), to: at(0.82, 0.7), label: '按住拖过去', delay: 1000 },
      { type: 'scroll', at: at(0.3, 0.62), direction: 'down', label: '往下滚', delay: 1250 },
      { type: 'keys', keys: ['Ctrl', 'Shift', 'S'], at: at(0.5, 0.86), label: '按这个快捷键', delay: 1500 },
      { type: 'html', rect: [...at(0.06, 0.74), 300, 120], html, delay: 1750 },
    ],
  };
  const r = await call('POST', '/show', { scene });
  out(`Demo drawn (${r.drawn.join(', ')}).${r.warnings.length ? ' Warnings: ' + r.warnings.join('; ') : ''}\nRun \`teach-me-agent clear\` to remove it.`);
}

function cmdInstallSkill({ flags }) {
  const src = path.join(ROOT, 'skill', 'teach-me-agent');
  const home = os.homedir();
  const targets = [];
  if (typeof flags.to === 'string') targets.push(path.resolve(flags.to));
  else {
    targets.push(path.join(home, '.cursor', 'skills'));
    if (fs.existsSync(path.join(home, '.claude'))) targets.push(path.join(home, '.claude', 'skills'));
    if (fs.existsSync(path.join(home, '.codex'))) targets.push(path.join(home, '.codex', 'skills'));
  }
  const cli = `node "${CLI_PATH}"`;
  const done = [];
  for (const t of targets) {
    const dest = path.join(t, 'teach-me-agent');
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      const content = fs.readFileSync(path.join(src, f), 'utf8').split('{{CLI}}').join(cli);
      fs.writeFileSync(path.join(dest, f), content);
    }
    done.push(dest);
  }
  out(['Installed the teach-me-agent skill to:', ...done.map((d) => '  ' + d), `The skill calls: ${cli}`].join('\n'));
}

// ---------- main ----------

const COMMANDS = {
  start: cmdStart,
  wait: cmdWait,
  say: cmdSay,
  show: cmdShow,
  clear: cmdClear,
  zoom: cmdZoom,
  status: cmdStatus,
  stop: cmdStop,
  demo: cmdDemo,
  'install-skill': cmdInstallSkill,
};

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || args.flags.help) return out(HELP);
  const fn = COMMANDS[cmd];
  if (!fn) fail(`unknown command "${cmd}". Run teach-me-agent help`);
  await fn(args);
})().catch((e) => fail(e.stack || e.message));
