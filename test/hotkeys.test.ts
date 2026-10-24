import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultHotkeys, hotkeysSchema, normalizeAccelerator } from '../src/shared/hotkeys.ts';
import { defaults, settingsSchema } from '../src/shared/protocol.ts';

test('normalizeAccelerator canonicalizes modifiers, case and spacing', () => {
  assert.equal(normalizeAccelerator('ctrl+alt+w'), 'Control+Alt+W');
  assert.equal(normalizeAccelerator('Shift+ alt +F10'), 'Shift+Alt+F10');
  // CommandOrControl is Control on this Windows host; aliases collapse.
  assert.equal(normalizeAccelerator('CmdOrCtrl+Shift+p'), 'Control+Shift+P');
  assert.equal(normalizeAccelerator('Alt+space'), 'Alt+Space');
  assert.equal(normalizeAccelerator('Alt+ESCAPE'), 'Alt+Escape');
});

test('normalizeAccelerator rejects plain keys, unknown tokens, duplicates and multi main keys', () => {
  assert.throws(() => normalizeAccelerator('A'), /修饰键/);
  assert.throws(() => normalizeAccelerator('Ctrl'), /主键/);
  assert.throws(() => normalizeAccelerator('Ctrl+WiFi'), /无法识别/);
  assert.throws(() => normalizeAccelerator('Ctrl+A+B'), /一个主键/);
  assert.throws(() => normalizeAccelerator('Ctrl+Ctrl+A'), /重复/);
  assert.throws(() => normalizeAccelerator('Ctrl+Control+A'), /重复/);
  assert.throws(() => normalizeAccelerator('Ctrl++'), /至少/);
});

test('hotkeys schema defaults, normalizes and rejects conflicts between actions', () => {
  assert.deepEqual(hotkeysSchema.parse(undefined), defaultHotkeys);
  const parsed = hotkeysSchema.parse({ ...defaultHotkeys, input: 'ctrl+ alt +j' });
  assert.equal(parsed.input, 'Control+Alt+J');
  assert.equal(parsed.guides, 'Control+Alt+H');
  const conflict = hotkeysSchema.safeParse({
    ...defaultHotkeys,
    board: defaultHotkeys.input,
  });
  assert.equal(conflict.success, false);
  assert.match(conflict.error.issues[0].message, /冲突/);
});

test('settings schema migrates pre-hotkey files and rejects invalid hotkeys', () => {
  // Simulates a settings.json written before the hotkeys group existed.
  const legacy = settingsSchema.parse({
    attachScreenshot: false,
    captureTier: 'ask',
    autoCollapseSec: 8,
    continueText: '继续',
    voice: {
      engine: 'local',
      localCommand: 'local-asr',
      customUrl: '',
      confirmMs: 1500,
      tts: false,
    },
  });
  assert.deepEqual(legacy.hotkeys, defaultHotkeys);
  assert.equal(legacy.voice.localCommand, 'local-asr');
  const invalid = settingsSchema.safeParse({
    ...defaults,
    hotkeys: { ...defaultHotkeys, guides: 'Q' },
  });
  assert.equal(invalid.success, false);
  assert.match(invalid.error.issues[0].message, /修饰键/);
});
