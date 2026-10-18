import type { PanelMode, Snapshot } from '../shared/protocol.ts';

export type PanelActivity = {
  input: Snapshot['input']['phase'];
  voice: Snapshot['voice']['phase'];
  draft: boolean;
  hover: boolean;
  focused: boolean;
  moving: boolean;
  tools: boolean;
  settings: boolean;
  board: boolean;
  request: boolean;
  error: boolean;
};
export type PanelState = { mode: PanelMode; unread: boolean };
export type PanelEvent = 'input' | 'reply' | 'attention' | 'idle' | PanelMode;

export function canCompact(a: PanelActivity) {
  return (
    a.input === 'idle' &&
    a.voice === 'idle' &&
    !Object.entries(a).some(([key, value]) => !['input', 'voice'].includes(key) && value === true)
  );
}

export function transitionPanel(s: PanelState, event: PanelEvent, a: PanelActivity): PanelState {
  switch (event) {
    case 'input':
      return { ...s, mode: s.mode === 'conversation' ? s.mode : 'compose' };
    case 'reply': {
      const occupied = a.input !== 'idle' || a.voice !== 'idle' || a.draft || a.moving;
      const mode = occupied ? s.mode : 'conversation';
      return { mode, unread: mode !== 'conversation' };
    }
    case 'attention':
    case 'conversation':
      return { mode: 'conversation', unread: false };
    case 'idle':
      return canCompact(a) ? { ...s, mode: 'mini' } : s;
    case 'mini':
      if (a.voice !== 'idle' || ['preparing', 'submitting'].includes(a.input) || a.request)
        return s;
      return { ...s, mode: 'mini' };
    case 'compose':
      return a.request ? s : { ...s, mode: 'compose' };
  }
}
