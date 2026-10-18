import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitionPanel, canCompact, type PanelActivity } from '../src/core/panel-mode.ts';
const idle: PanelActivity = {
  input: 'idle',
  voice: 'idle',
  draft: false,
  hover: false,
  focused: false,
  moving: false,
  tools: false,
  settings: false,
  board: false,
  request: false,
  error: false,
};
test('input opens compose; replies open conversation; idle returns to a pill', () => {
  const compose = transitionPanel({ mode: 'mini', unread: false }, 'input', idle);
  assert.equal(compose.mode, 'compose');
  const reply = transitionPanel(compose, 'reply', idle);
  assert.deepEqual(reply, { mode: 'conversation', unread: false });
  assert.equal(transitionPanel(reply, 'idle', idle).mode, 'mini');
});
test('draft, hover, focus, voice, editing, tools and approvals each prevent idle compaction', () => {
  const s = { mode: 'conversation', unread: false } as const;
  for (const a of [
    ...[
      'draft',
      'hover',
      'focused',
      'moving',
      'tools',
      'settings',
      'board',
      'request',
      'error',
    ].map((k) => ({ ...idle, [k]: true })),
    { ...idle, input: 'editing' as const },
    { ...idle, voice: 'review' as const },
  ]) {
    assert.equal(canCompact(a), false);
    assert.equal(transitionPanel(s, 'idle', a), s);
  }
});
test('a reply while typing or recording marks unread without changing the input layout', () => {
  for (const a of [
    { ...idle, input: 'editing' as const },
    { ...idle, draft: true },
    { ...idle, voice: 'recording' as const },
  ]) {
    const reply = transitionPanel({ mode: 'compose', unread: false }, 'reply', a);
    assert.deepEqual(reply, { mode: 'compose', unread: true });
    assert.deepEqual(transitionPanel(reply, 'conversation', a), {
      mode: 'conversation',
      unread: false,
    });
  }
});
test('manual compaction preserves a draft but cannot conceal an approval or active recording', () => {
  const s = { mode: 'compose', unread: true } as const;
  assert.equal(transitionPanel(s, 'mini', { ...idle, draft: true }).mode, 'mini');
  for (const a of [
    { ...idle, request: true },
    { ...idle, voice: 'recording' as const },
    { ...idle, input: 'preparing' as const },
  ])
    assert.equal(transitionPanel(s, 'mini', a), s);
});
