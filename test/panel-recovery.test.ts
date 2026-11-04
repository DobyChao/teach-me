import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANEL_RECOVERY_FAILURE,
  PANEL_RECOVERY_HOTKEY,
  PANEL_RECOVERY_INTERRUPTED,
  PANEL_RECOVERY_STATUS,
  PanelRecoveryController,
} from '../src/core/panel-recovery.ts';

const dangerous = [
  'prepare',
  'submit',
  'cancel',
  'continue',
  'settings',
  'settings-focus',
  'edit',
  'quit',
  'end',
  'voice-start',
  'voice-stop',
  'voice-cancel',
  'toggle-guides',
  'clear',
  'panel-mode',
] as const;

function controller(start = 1_000_000) {
  let now = start;
  return {
    now: (value: number) => (now = value),
    recovery: new PanelRecoveryController(() => now),
  };
}

test('recovering swallows dangerous main controls and keeps quit from running', () => {
  const { recovery } = controller();
  assert.equal(recovery.begin(false), 'started');
  assert.equal(recovery.view().active, true);
  assert.equal(recovery.view().status, PANEL_RECOVERY_STATUS);
  let quit = 0;
  let ran = 0;
  const dispatch = (type: string) => {
    if (recovery.decide(type) === 'run') {
      ran += 1;
      if (type === 'quit' || type === 'end') quit += 1;
      return 'ran';
    }
    return 'swallowed';
  };
  for (let i = 0; i < 5; i++) assert.equal(dispatch('submit'), 'swallowed');
  for (const type of dangerous) assert.equal(dispatch(type), 'swallowed');
  assert.equal(dispatch('quit'), 'swallowed');
  assert.equal(dispatch('edit'), 'swallowed');
  assert.equal(dispatch('settings-focus'), 'swallowed');
  assert.equal(dispatch('cancel'), 'swallowed');
  assert.equal(quit, 0);
  assert.equal(ran, 0);
  assert.equal(recovery.decide('voice-start'), 'swallow');
  assert.equal(recovery.decide('board-change'), 'run');
  assert.equal(recovery.decide('hover'), 'swallow');
});

test('talk hotkey during recovery shows the locked tip and does not open the mic', () => {
  const { recovery } = controller();
  recovery.begin(false);
  let mic = false;
  if (!recovery.interceptTalk()) mic = true;
  assert.equal(mic, false);
  assert.equal(recovery.decide('voice-start'), 'swallow');
  assert.equal(recovery.view().hotkeyTip, PANEL_RECOVERY_HOTKEY);
  assert.equal(recovery.view().status, PANEL_RECOVERY_STATUS);
  const generation = recovery.currentGeneration;
  assert.equal(recovery.complete(generation), true);
  assert.equal(recovery.view().hotkeyTip, null);
  assert.equal(recovery.view().status, null);
  assert.equal(recovery.view().active, false);
  assert.equal(recovery.interceptTalk(), false);
  assert.equal(recovery.decide('voice-start'), 'run');
});

test('interrupted recording keeps the locked copy and does not insert a user message', () => {
  const { recovery } = controller();
  const messages: { role: string; text: string }[] = [];
  assert.equal(recovery.begin(true), 'started');
  if (recovery.decide('voice-stop') === 'run' || recovery.decide('submit') === 'run')
    messages.push({ role: 'user', text: '这句其实没说完' });
  assert.deepEqual(messages, []);
  assert.equal(recovery.view().voiceTip, PANEL_RECOVERY_INTERRUPTED);
  assert.equal(recovery.interceptTalk(), true);
  assert.equal(recovery.view().hotkeyTip, PANEL_RECOVERY_HOTKEY);
  assert.equal(recovery.complete(recovery.currentGeneration), true);
  assert.equal(recovery.view().voiceTip, null);
  assert.equal(recovery.view().hotkeyTip, null);
  assert.deepEqual(messages, []);
});

test('idle voice does not claim the utterance was dropped', () => {
  const { recovery } = controller();
  recovery.begin(false);
  assert.equal(recovery.view().voiceTip, null);
  assert.equal(recovery.view().status, PANEL_RECOVERY_STATUS);
});

test('stale generation cannot clear or overwrite the attempt in progress', () => {
  const { now, recovery } = controller();
  assert.equal(recovery.begin(true), 'started');
  const first = recovery.currentGeneration;
  assert.equal(recovery.interceptTalk(), true);
  assert.equal(recovery.complete(first - 1), false);
  assert.equal(recovery.fail(first - 1), false);
  assert.equal(recovery.acceptsCallback(first - 1), false);
  assert.equal(recovery.view().status, PANEL_RECOVERY_STATUS);
  assert.equal(recovery.view().hotkeyTip, PANEL_RECOVERY_HOTKEY);
  assert.equal(recovery.view().voiceTip, PANEL_RECOVERY_INTERRUPTED);
  assert.equal(recovery.complete(first), true);
  assert.equal(recovery.acceptsCallback(first), true);
  now(1_000_000 + 61_000);
  assert.equal(recovery.begin(false), 'started');
  const second = recovery.currentGeneration;
  assert.notEqual(second, first);
  assert.equal(recovery.complete(first), false);
  assert.equal(recovery.fail(first), false);
  assert.equal(recovery.acceptsCallback(first), false);
  assert.equal(recovery.view().active, true);
  assert.equal(recovery.view().status, PANEL_RECOVERY_STATUS);
  assert.equal(recovery.view().voiceTip, null);
  assert.equal(recovery.decide('quit'), 'swallow');
});

test('failure and exhausted recovery keep a status string and still swallow quit', () => {
  const failed = controller();
  assert.equal(failed.recovery.begin(true), 'started');
  const generation = failed.recovery.currentGeneration;
  assert.equal(failed.recovery.fail(generation), true);
  assert.equal(failed.recovery.view().status, PANEL_RECOVERY_FAILURE);
  assert.notEqual(failed.recovery.view().status, '');
  assert.equal(failed.recovery.view().hotkeyTip, null);
  assert.equal(failed.recovery.view().voiceTip, null);
  assert.equal(failed.recovery.view().active, true);
  assert.equal(failed.recovery.decide('quit'), 'swallow');
  assert.equal(failed.recovery.decide('submit'), 'swallow');
  assert.equal(failed.recovery.fail(generation), false);

  const { now, recovery } = controller(20_000);
  assert.equal(recovery.begin(false), 'started');
  assert.equal(recovery.complete(recovery.currentGeneration), true);
  now(21_000);
  assert.equal(recovery.begin(false), 'exhausted');
  assert.equal(recovery.view().status, PANEL_RECOVERY_FAILURE);
  assert.equal(recovery.decide('edit'), 'swallow');
  assert.equal(recovery.decide('quit'), 'swallow');
  assert.equal(recovery.view().active, true);
});
