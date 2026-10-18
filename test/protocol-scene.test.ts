import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionSchema,
  canContinue,
  defaults,
  hasBoard,
  hasGuides,
  settingsSchema,
} from '../src/shared/protocol.ts';
import type { Shot, Snapshot } from '../src/shared/protocol.ts';
import { mapGuides, parseScene } from '../src/core/scene.ts';
const shot: Shot = {
  id: 's1',
  path: 'x',
  width: 1600,
  height: 1000,
  displayId: 2,
  bounds: { x: -1200, y: 0, width: 1200, height: 750 },
  scaleFactor: 2,
  at: 0,
};
const state: Snapshot = {
  selectingDisplay: false,
  voice: { id: null, phase: 'idle', text: '', error: null },
  revision: 0,
  session: { id: 'session', topic: 'test', phase: 'waiting' },
  messages: [{ id: 1, role: 'agent', text: '试试', at: 0, shots: [] }],
  input: { phase: 'idle', turnId: null, error: null },
  guides: [],
  guidesHidden: false,
  userBoard: { epoch: 0, count: 0 },
  editing: false,
  collapsed: false,
  panelMode: 'conversation',
  panelAnimating: false,
  unreadReply: false,
  settings: defaults,
  capture: null,
  connection: null,
  displays: [],
  displayId: 2,
  error: null,
};
test('wait means ready for reply; typing and preparation suppress continue', () => {
  assert.equal(canContinue(state, ''), true);
  assert.equal(canContinue(state, '草稿'), false);
  assert.equal(
    canContinue({ ...state, input: { phase: 'preparing', turnId: 't', error: null } }, ''),
    false,
  );
});
test('legacy settings stay protected unless remote visibility is enabled', () => {
  const legacy = { ...defaults };
  delete (legacy as Partial<typeof defaults>).showInScreenCapture;
  assert.equal(settingsSchema.parse(legacy).showInScreenCapture, false);
  assert.equal(
    settingsSchema.parse({ ...legacy, showInScreenCapture: true }).showInScreenCapture,
    true,
  );
});
test('arrow-only guide existence is distinct from attachable board', () => {
  const next = { ...state, guides: [{ type: 'arrow' as const, to: [10, 10] as [number, number] }] };
  assert.equal(hasGuides(next), true);
  assert.equal(hasBoard(next), false);
});
test('user editor content is attachable independently of Agent guides', () => {
  const next = { ...state, userBoard: { epoch: 3, count: 1 } };
  assert.equal(hasBoard(next), true);
  assert.equal(hasGuides(next), false);
  assert.equal(
    actionSchema.safeParse({ type: 'board-change', epoch: -1, count: 1 }).success,
    false,
  );
  assert.equal(
    actionSchema.safeParse({ type: 'board-change', epoch: 3, count: Infinity }).success,
    false,
  );
});
test('scene without say fails and arbitrary IPC commands fail', () => {
  assert.throws(() => parseScene({ items: [] }));
  assert.equal(actionSchema.safeParse({ type: 'execute', code: 'evil' }).success, false);
});
test('shot pixels map to selected display DIP including negative desktop positions', () => {
  const scene = parseScene({ say: '这里', pattern: 'point', to: [800, 500] });
  const [guide] = mapGuides(scene, shot, shot.bounds, 2);
  assert.equal(guide.type, 'arrow');
  if (guide.type === 'arrow') assert.deepEqual(guide.to, [600, 375]);
});
test('layout/display changes reject stale coordinates', () => {
  const scene = parseScene({ say: '这里', items: [] });
  assert.throws(() => mapGuides(scene, shot, { ...shot.bounds, width: 1300 }, 2));
  assert.throws(() => mapGuides(scene, shot, shot.bounds, 1));
});
test('zoom coordinates map back through crop offsets to the selected display', () => {
  const cropped = {
    ...shot,
    width: 400,
    height: 250,
    crop: { x: 300, y: 120, width: 300, height: 187.5 },
  };
  const [guide] = mapGuides(
    parseScene({ say: '这里', items: [{ type: 'arrow', to: [200, 100] }] }),
    cropped,
    shot.bounds,
    2,
  );
  if (guide.type === 'arrow') assert.deepEqual(guide.to, [450, 195]);
  else assert.fail('expected arrow');
});
