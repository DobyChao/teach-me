const fs = require('fs');
const os = require('os');
const path = require('path');

const home =
  process.env.TEACH_ME_AGENT_HOME ||
  (process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'teach-me-agent')
    : path.join(os.homedir(), '.teach-me-agent'));

const stateFile = path.join(home, 'state.json');
const configFile = path.join(home, 'config.json');
const sessionsDir = path.join(home, 'sessions');
const logFile = path.join(home, 'app.log');

const defaultConfig = {
  hotkeys: {
    // Input entry: hold = voice, click = text. Board-edit and capture-allow
    // stay unbound until the notes pick a key. Continue is unbound on purpose.
    talk: 'Control+Alt+W',
    toggleOverlay: 'Control+Alt+H',
    continue: '',
    boardEdit: '',
    captureAllow: '',
  },
  // Overlay, panel and freeze windows are hidden from screen capture so the
  // agent always sees the real UI. Turn this on if you screen-share a lesson.
  showInScreenCapture: false,
  // Images handed to the agent are capped so that agent harnesses which
  // downscale before the model sees them (Cursor shows at most 1024px) keep
  // the model's perceived pixels equal to the file's pixels; otherwise every
  // coordinate it reads off the image comes back scaled. Detail comes from
  // `zoom`, which crops the full-resolution frame.
  maxImageEdge: 1024,
  maxImagePixels: 1024 * 1024,
  // Session folders hold screenshots of the user's screen; older ones are
  // deleted at startup. 0 keeps everything.
  keepSessionsDays: 7,
  // User-sent messages attach a screenshot unless this is turned off.
  // Those shots are not run through the agent capture approval tiers.
  attachScreenshot: true,
  voice: {
    engine: 'system',
    customUrl: '',
    localCommand: '',
    tts: 'off',
    confirmMs: 1500,
  },
  capture: {
    tier: 'ask',
  },
  appearance: {
    mode: 'capsule',
    autoCollapseSec: 8,
  },
  onboarded: false,
};

const HOTKEY_NAMES = ['talk', 'toggleOverlay', 'continue', 'boardEdit', 'captureAllow'];

function pickHotkeys(user) {
  const src = (user && user.hotkeys) || {};
  const hotkeys = { ...defaultConfig.hotkeys };
  for (const name of HOTKEY_NAMES) {
    if (typeof src[name] === 'string') hotkeys[name] = src[name];
  }
  return hotkeys;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig() {
  const user = readJson(configFile) || {};
  return {
    ...defaultConfig,
    ...user,
    hotkeys: pickHotkeys(user),
    voice: { ...defaultConfig.voice, ...(user.voice || {}) },
    capture: { ...defaultConfig.capture, ...(user.capture || {}) },
    appearance: { ...defaultConfig.appearance, ...(user.appearance || {}) },
    attachScreenshot: typeof user.attachScreenshot === 'boolean' ? user.attachScreenshot : defaultConfig.attachScreenshot,
    onboarded: typeof user.onboarded === 'boolean' ? user.onboarded : defaultConfig.onboarded,
    keepSessionsDays: Number.isFinite(Number(user.keepSessionsDays)) ? Number(user.keepSessionsDays) : defaultConfig.keepSessionsDays,
  };
}

function saveConfig(config) {
  const next = loadConfig();
  const patch = config || {};
  const merged = {
    ...next,
    ...patch,
    hotkeys: pickHotkeys({ hotkeys: { ...next.hotkeys, ...(patch.hotkeys || {}) } }),
    voice: { ...next.voice, ...(patch.voice || {}) },
    capture: { ...next.capture, ...(patch.capture || {}) },
    appearance: { ...next.appearance, ...(patch.appearance || {}) },
    attachScreenshot: typeof patch.attachScreenshot === 'boolean' ? patch.attachScreenshot : next.attachScreenshot,
    onboarded: typeof patch.onboarded === 'boolean' ? patch.onboarded : next.onboarded,
  };
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(merged, null, 2));
  return loadConfig();
}

function readState() {
  return readJson(stateFile);
}

module.exports = {
  home,
  stateFile,
  configFile,
  sessionsDir,
  logFile,
  defaultConfig,
  loadConfig,
  saveConfig,
  readState,
  readJson,
};
