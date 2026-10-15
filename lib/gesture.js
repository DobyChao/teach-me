// One entry: a short press is text, a hold is voice. Screenshot timing sits
// outside this helper — text captures before the field opens, voice captures
// when the hold crosses into speech.

const HOLD_MS = 280;

function createGesture({ holdMs = HOLD_MS } = {}) {
  let downAt = 0;
  let mode = 'idle';
  return {
    get mode() {
      return mode;
    },
    down(t) {
      downAt = t;
      mode = 'pending';
      return { mode };
    },
    tick(t) {
      if (mode !== 'pending') return { mode };
      if (t - downAt >= holdMs) {
        mode = 'voice';
        return { mode, became: 'voice' };
      }
      return { mode };
    },
    up(t) {
      const duration = t - downAt;
      if (mode === 'pending') {
        mode = 'idle';
        return { mode: 'text', became: 'text', duration };
      }
      if (mode === 'voice') {
        mode = 'idle';
        return { mode: 'voice', release: true, duration };
      }
      mode = 'idle';
      return { mode: 'idle', duration };
    },
  };
}

function classifyDuration(durationMs, holdMs = HOLD_MS) {
  return durationMs >= holdMs ? 'voice' : 'text';
}

// Poll `isDown` until the chord lifts or the hold threshold passes.
// `isDown` returns true/false, or null when this platform cannot see key-up
// (treat that as a click so the hotkey still opens text).
async function resolveHold(isDown, { holdMs = HOLD_MS, pollMs = 40, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const t0 = now();
  if (typeof isDown !== 'function') return { held: false, duration: 0, unknown: true };
  const first = await isDown();
  if (first == null) return { held: false, duration: 0, unknown: true };
  if (!first) return { held: false, duration: now() - t0 };
  while (now() - t0 < holdMs) {
    await sleep(pollMs);
    const down = await isDown();
    if (down == null) return { held: false, duration: now() - t0, unknown: true };
    if (!down) return { held: false, duration: now() - t0 };
  }
  return { held: true, duration: now() - t0 };
}

const VK = {
  Control: 0x11,
  Ctrl: 0x11,
  CommandOrControl: 0x11,
  Command: 0x11,
  Cmd: 0x11,
  Alt: 0x12,
  Option: 0x12,
  Shift: 0x10,
};

function acceleratorVks(acc) {
  if (!acc || typeof acc !== 'string') return null;
  const parts = acc.split('+').filter(Boolean);
  if (!parts.length) return null;
  const vks = [];
  for (const part of parts) {
    if (VK[part] != null) {
      vks.push(VK[part]);
      continue;
    }
    if (/^[A-Za-z0-9]$/.test(part)) {
      vks.push(part.toUpperCase().charCodeAt(0));
      continue;
    }
    return null;
  }
  return vks;
}

module.exports = { HOLD_MS, createGesture, classifyDuration, resolveHold, acceleratorVks };
