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
    freeze: 'Control+Alt+Q',
    talk: 'Control+Alt+W',
    toggleOverlay: 'Control+Alt+H',
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
};

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
    hotkeys: { ...defaultConfig.hotkeys, ...(user.hotkeys || {}) },
  };
}

function readState() {
  return readJson(stateFile);
}

module.exports = { home, stateFile, configFile, sessionsDir, logFile, loadConfig, readState, readJson };
