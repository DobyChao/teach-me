// Agent capture approval and the lightweight context that rides with it.
// `wait` must not include that context — strip it before a wait result leaves
// the app. Capture failures retry a finite number of times.

const TIERS = new Set(['ask', 'lesson', 'always']);
const LESSON_COUNTDOWN_MS = 3000;
const MAX_ATTEMPTS = 3;

function normalizeTier(tier) {
  return TIERS.has(tier) ? tier : 'ask';
}

function beginCapture(tier) {
  const name = normalizeTier(tier);
  if (name === 'always') return { tier: name, phase: 'approved', countdownMs: 0 };
  if (name === 'lesson') return { tier: name, phase: 'countdown', countdownMs: LESSON_COUNTDOWN_MS };
  return { tier: name, phase: 'pending', countdownMs: 0 };
}

// The approval hotkey is context-sensitive: during the lesson-allow countdown
// it interrupts back to pending; while pending it allows. Binding is TBD.
function hotkeyOnCapture(phase) {
  if (phase === 'countdown') return 'interrupt';
  if (phase === 'pending') return 'allow';
  return 'ignore';
}

function applyCaptureDecision(state, decision) {
  const phase = state && state.phase;
  if (decision === 'interrupt' || (decision == null && hotkeyOnCapture(phase) === 'interrupt' && state && state.viaHotkey)) {
    return { ...state, phase: 'pending', countdownMs: 0, interrupted: true };
  }
  if (decision === 'allow') return { ...state, phase: 'approved', countdownMs: 0 };
  if (decision === 'deny') return { ...state, phase: 'denied', countdownMs: 0 };
  if (phase === 'countdown' && decision === 'timeout') return { ...state, phase: 'approved', countdownMs: 0 };
  return { ...state };
}

function interruptCountdown(state) {
  if (!state || state.phase !== 'countdown') return state;
  return applyCaptureDecision(state, 'interrupt');
}

function normalizeBounds(raw) {
  if (!raw) return null;
  const b = Array.isArray(raw) ? { x: raw[0], y: raw[1], width: raw[2], height: raw[3] } : raw;
  const x = Number(b.x);
  const y = Number(b.y);
  const width = Number(b.width);
  const height = Number(b.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  return { x, y, width, height };
}

function normalizeMouse(raw) {
  if (!raw) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

// Full window title is included only when the caller passes the explicit flag.
function lightweightContext(raw, { includeTitle = false } = {}) {
  const ctx = {
    focusedProcess: raw && raw.focusedProcess ? String(raw.focusedProcess) : null,
    mouse: normalizeMouse(raw && raw.mouse),
    foregroundBounds: normalizeBounds(raw && raw.foregroundBounds),
  };
  if (includeTitle) ctx.windowTitle = raw && raw.windowTitle ? String(raw.windowTitle) : null;
  return ctx;
}

function stripMessageContext(message) {
  if (!message || typeof message !== 'object') return message;
  const {
    context,
    focusedProcess,
    mouse,
    foregroundBounds,
    windowTitle,
    ...rest
  } = message;
  return rest;
}

function withoutCaptureContext(waitResult) {
  if (!waitResult || typeof waitResult !== 'object') return waitResult;
  const {
    context,
    focusedProcess,
    mouse,
    foregroundBounds,
    windowTitle,
    ...rest
  } = waitResult;
  if (Array.isArray(rest.messages)) rest.messages = rest.messages.map(stripMessageContext);
  return rest;
}

async function withRetries(fn, { attempts = MAX_ATTEMPTS, delayMs = 0 } = {}) {
  const total = Math.max(1, attempts | 0);
  let error;
  for (let i = 1; i <= total; i++) {
    try {
      const value = await fn(i);
      return { value, attempts: i };
    } catch (e) {
      error = e;
      if (i < total && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  const err = new Error((error && error.message) || 'capture failed');
  err.attempts = total;
  err.cause = error;
  throw err;
}

module.exports = {
  TIERS,
  LESSON_COUNTDOWN_MS,
  MAX_ATTEMPTS,
  normalizeTier,
  beginCapture,
  hotkeyOnCapture,
  applyCaptureDecision,
  interruptCountdown,
  lightweightContext,
  withoutCaptureContext,
  withRetries,
};
