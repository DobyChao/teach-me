import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, settingsSchema } from '../src/shared/protocol.ts';
import { defaultAppearance, resolveScheme, themes } from '../src/shared/appearance.ts';

test('old settings acquire the default appearance without losing capture or voice preferences', () => {
  const { appearance, ...old } = defaults;
  const migrated = settingsSchema.parse({
    ...old,
    attachScreenshot: false,
    continueText: '继续',
    voice: { ...old.voice, engine: 'local', localCommand: 'local-asr' },
  });
  assert.deepEqual(migrated.appearance, defaultAppearance);
  assert.equal(migrated.attachScreenshot, false);
  assert.equal(migrated.voice.localCommand, 'local-asr');
  assert.equal(migrated.continueText, '继续');
  assert.equal(
    settingsSchema.safeParse({ ...defaults, appearance: { mode: 'light', theme: 'rose' } }).success,
    true,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...defaults,
      appearance: { mode: 'light', theme: 'https://untrusted/theme.js' },
    }).success,
    false,
  );
});
test('explicit modes override the system and system mode responds to both OS values', () => {
  assert.equal(resolveScheme('light', true), 'light');
  assert.equal(resolveScheme('dark', false), 'dark');
  assert.equal(resolveScheme('system', true), 'dark');
  assert.equal(resolveScheme('system', false), 'light');
});
test('theme palettes share semantic keys and readable text contrast in each color scheme', () => {
  const luminance = (hex: string) => {
    const [r, g, b] = hex
      .slice(1)
      .match(/../g)!
      .map((v) => {
        const c = parseInt(v, 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const theme of Object.values(themes)) {
    assert.deepEqual(Object.keys(theme.light).sort(), Object.keys(theme.dark).sort());
    for (const p of [theme.light, theme.dark]) {
      for (const color of Object.values(p)) assert.match(color, /^#[0-9a-f]{6}$/i);
      for (const surface of [p.bg, p.surface]) {
        assert.ok(contrast(p.text, surface) >= 4.5);
        assert.ok(contrast(p.muted, surface) >= 4.5);
      }
      assert.ok(contrast(p['on-accent'], p.accent) >= 4.5);
    }
  }
});
