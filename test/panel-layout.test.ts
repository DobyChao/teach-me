import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelBounds } from '../src/core/panel-layout.ts';

test('mini panel uses 360 DIP and preserves its dragged anchor through expansion and multiline input', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const anchor = { right: 1100, bottom: 750 };
  const mini = panelBounds(76, true, area, anchor);
  const expanded = panelBounds(420, false, area, anchor);
  const multiline = panelBounds(160, true, area, anchor);
  assert.deepEqual(mini, { x: 740, y: 674, width: 360, height: 76 });
  for (const bounds of [expanded, multiline]) {
    assert.equal(bounds.x + bounds.width, anchor.right);
    assert.equal(bounds.y + bounds.height, anchor.bottom);
  }
});

test('a moved or disconnected display never leaves the panel outside available work area', () => {
  const area = { x: -1280, y: -200, width: 1280, height: 900 };
  for (const anchor of [
    { right: 8000, bottom: 3000 },
    { right: -9000, bottom: -5000 },
  ]) {
    const b = panelBounds(560, false, area, anchor);
    assert.ok(b.x >= area.x && b.y >= area.y);
    assert.ok(b.x + b.width <= area.x + area.width);
    assert.ok(b.y + b.height <= area.y + area.height);
  }
});

test('mini and expanded modes fit a narrow work area without clipping outside the screen', () => {
  const area = { x: 100, y: 100, width: 320, height: 240 };
  const b = panelBounds(560, false, area);
  assert.deepEqual(b, { x: 108, y: 108, width: 304, height: 224 });
});
