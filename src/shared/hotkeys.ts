import { z } from 'zod';

export const hotkeyActions = ['input', 'guides', 'board', 'continue'] as const;
export type HotkeyAction = (typeof hotkeyActions)[number];
export const hotkeyLabels: Record<HotkeyAction, string> = {
  input: '唤醒输入',
  guides: '指引显隐',
  board: '画板开关',
  continue: '继续教学',
};
export const defaultHotkeys: Record<HotkeyAction, string> = {
  input: 'Control+Alt+W',
  guides: 'Control+Alt+H',
  board: 'Control+Alt+B',
  continue: 'Control+Alt+N',
};

// Electron accelerator grammar subset: at least one modifier, exactly one key,
// so a hotkey can never shadow plain typing in the target application.
// Canonical form so aliases (Ctrl/Control, Cmd/Meta, CommandOrControl on
// Windows) collapse to one spelling; otherwise conflict detection would miss
// the same physical key written two ways.
const modifierCanonical: Record<string, string> = {
  commandorcontrol: 'Control',
  cmdorctrl: 'Control',
  command: 'Meta',
  cmd: 'Meta',
  control: 'Control',
  ctrl: 'Control',
  option: 'Alt',
  alt: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Meta',
};
const keyCanonical: Record<string, string> = { esc: 'Escape', del: 'Delete' };
const namedKeys = [
  'Plus',
  'Space',
  'Tab',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'PrintScreen',
];
export function normalizeAccelerator(input: string): string {
  const tokens = input
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length < 2) throw new Error('快捷键至少需要一个修饰键和一个主键');
  const mods: string[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const mod = modifierCanonical[lower];
    if (mod) {
      if (mods.includes(mod)) throw new Error(`修饰键重复：${mod}`);
      mods.push(mod);
      continue;
    }
    let key: string | undefined;
    if (/^[0-9a-z]$/i.test(token)) key = token.toUpperCase();
    else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(token)) key = 'F' + lower.slice(1);
    else key = keyCanonical[lower] ?? namedKeys.find((k) => k.toLowerCase() === lower);
    if (!key) throw new Error(`无法识别的按键：${token}`);
    keys.push(key);
  }
  if (!mods.length) throw new Error('至少需要一个修饰键（Ctrl/Alt/Shift 等）');
  if (keys.length !== 1) throw new Error('快捷键只能有一个主键');
  return [...mods, keys[0]].join('+');
}

const acceleratorSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .superRefine((value, ctx) => {
    try {
      normalizeAccelerator(value);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: (e as Error).message });
    }
  })
  .transform(normalizeAccelerator);
export const hotkeysSchema = z
  .object({
    input: acceleratorSchema,
    guides: acceleratorSchema,
    board: acceleratorSchema,
    continue: acceleratorSchema,
  })
  .superRefine((hotkeys, ctx) => {
    const seen = new Map<string, HotkeyAction>();
    for (const act of hotkeyActions) {
      const key = hotkeys[act];
      const first = seen.get(key);
      if (first)
        ctx.addIssue({
          code: 'custom',
          message: `快捷键冲突：${hotkeyLabels[first]}与${hotkeyLabels[act]}都是 ${key}`,
        });
      else seen.set(key, act);
    }
  })
  .default(defaultHotkeys);
export type Hotkeys = z.infer<typeof hotkeysSchema>;
