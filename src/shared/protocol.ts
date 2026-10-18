import { z } from 'zod';

const point = z.tuple([z.number().finite(), z.number().finite()]);
const rect = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().positive(),
  z.number().positive(),
]);
export const guideSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('arrow'),
    to: point,
    from: point.optional(),
    label: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('box'), rect, label: z.string().max(200).optional() }),
  z.object({ type: z.literal('spotlight'), rect }),
  z.object({ type: z.literal('label'), at: point, text: z.string().max(500) }),
  z.object({ type: z.literal('keys'), keys: z.array(z.string().max(40)).min(1).max(8) }),
  z.object({ type: z.literal('stroke'), points: z.array(point).min(2).max(5000) }),
  z.object({
    type: z.literal('click'),
    at: point,
    button: z.enum(['left', 'right', 'double', 'middle']).default('left'),
  }),
  z.object({ type: z.literal('drag'), from: point, to: point }),
  z.object({ type: z.literal('path'), points: z.array(point).min(2).max(5000) }),
  z.object({
    type: z.literal('step'),
    at: point,
    n: z.number().int().min(1).max(99),
    label: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('scroll'),
    at: point,
    direction: z.enum(['up', 'down', 'left', 'right']),
  }),
  z.object({
    type: z.literal('html'),
    rect,
    html: z
      .string()
      .min(1)
      .max(256 * 1024),
    ttl: z.number().int().min(1000).max(60000).default(15000),
  }),
]);
export type Guide = z.infer<typeof guideSchema>;
export const sceneSchema = z.object({
  say: z.string().trim().min(1).max(8000),
  shot: z.string().optional(),
  items: z.array(guideSchema).max(50).default([]),
});
export type Scene = z.infer<typeof sceneSchema>;
export const settingsSchema = z.object({
  showInScreenCapture: z.boolean().default(false),
  attachScreenshot: z.boolean(),
  captureTier: z.enum(['ask', 'lesson', 'always']),
  autoCollapseSec: z.number().min(0).max(120),
  continueText: z.string().trim().min(1).max(80),
  voice: z
    .object({
      engine: z.enum(['system', 'local', 'custom']),
      localCommand: z.string().max(1000),
      customUrl: z.string().max(2000),
      confirmMs: z.number().min(1000).max(2000),
      tts: z.boolean(),
    })
    .default({ engine: 'system', localCommand: '', customUrl: '', confirmMs: 1500, tts: false }),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  showInScreenCapture: false,
  attachScreenshot: true,
  captureTier: 'ask',
  autoCollapseSec: 8,
  continueText: '下一步呢？',
  voice: { engine: 'system', localCommand: '', customUrl: '', confirmMs: 1500, tts: false },
};
export const panelModeSchema = z.enum(['mini', 'compose', 'conversation']);
export type PanelMode = z.infer<typeof panelModeSchema>;
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('prepare') }),
  z.object({ type: z.literal('copy-connect') }),
  z.object({
    type: z.literal('submit'),
    turnId: z.string(),
    text: z.string().trim().min(1).max(16000),
    attachBoard: z.boolean(),
  }),
  z.object({ type: z.literal('cancel') }),
  z.object({ type: z.literal('continue') }),
  z.object({ type: z.literal('toggle-expanded') }),
  z.object({ type: z.literal('panel-mode'), mode: panelModeSchema }),
  z.object({
    type: z.literal('panel-context'),
    hasDraft: z.boolean(),
    toolsOpen: z.boolean(),
    reducedMotion: z.boolean(),
  }),
  z.object({ type: z.literal('hover'), on: z.boolean() }),
  z.object({ type: z.literal('toggle-guides') }),
  z.object({ type: z.literal('clear'), layer: z.enum(['agent', 'user', 'all']) }),
  z.object({ type: z.literal('edit'), on: z.boolean() }),
  z.object({ type: z.literal('settings'), settings: settingsSchema }),
  z.object({
    type: z.literal('board-change'),
    epoch: z.number().int().nonnegative(),
    count: z.number().int().min(0).max(10000),
  }),
  z.object({ type: z.literal('settings-focus'), on: z.boolean() }),
  z.object({
    type: z.literal('capture-decision'),
    decision: z.enum(['allow', 'deny', 'interrupt']),
  }),
  z.object({ type: z.literal('connection-decision'), allow: z.boolean() }),
  z.object({ type: z.literal('select-display'), id: z.number() }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('quit') }),
  z.object({
    type: z.literal('resize'),
    height: z.number().min(48).max(800),
    mode: panelModeSchema,
  }),
  z.object({
    type: z.literal('panel-drag'),
    phase: z.enum(['start', 'move', 'end']),
    dragId: z.string().uuid(),
    dx: z.number().finite().min(-100000).max(100000),
    dy: z.number().finite().min(-100000).max(100000),
  }),
  z.object({ type: z.literal('voice-start') }),
  z.object({ type: z.literal('voice-stop') }),
  z.object({ type: z.literal('voice-cancel') }),
  z.object({
    type: z.literal('voice-audio'),
    id: z.string(),
    mime: z.string().max(100),
    data: z.instanceof(Uint8Array).refine((data) => data.byteLength <= 8 * 1024 * 1024),
  }),
  z.object({ type: z.literal('voice-error'), id: z.string(), error: z.string().max(1000) }),
]);
export type Action = z.infer<typeof actionSchema>;
export type AgentPhase = 'offline' | 'ready' | 'waiting' | 'thinking' | 'ended';
export interface Shot {
  id: string;
  path: string;
  width: number;
  height: number;
  displayId: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  at: number;
  crop?: { x: number; y: number; width: number; height: number };
}
export interface Message {
  id: number;
  role: 'agent' | 'user' | 'notice';
  text: string;
  at: number;
  shots: Shot[];
}
export interface Snapshot {
  selectingDisplay: boolean;
  voice: {
    id: string | null;
    phase: 'idle' | 'starting' | 'recording' | 'transcribing' | 'review';
    text: string;
    error: string | null;
  };
  revision: number;
  session: { id: string; topic: string; phase: AgentPhase } | null;
  messages: Message[];
  input: {
    phase: 'idle' | 'preparing' | 'editing' | 'submitting' | 'failed';
    turnId: string | null;
    error: string | null;
  };
  guides: Guide[];
  guidesHidden: boolean;
  userBoard: { epoch: number; count: number };
  editing: boolean;
  collapsed: boolean;
  panelMode: PanelMode;
  panelAnimating: boolean;
  unreadReply: boolean;
  settings: Settings;
  capture: { phase: 'pending' | 'countdown'; remaining: number } | null;
  connection: { kind: 'start' | 'attach'; topic: string } | null;
  displays: { id: number; label: string; width: number; height: number; scaleFactor: number }[];
  displayId: number | null;
  error: string | null;
}
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  perform(action: Action): Promise<Snapshot>;
  subscribe(listener: (state: Snapshot) => void): () => void;
}
declare global {
  interface Window {
    companion?: Bridge;
  }
}

export const hasGuides = (s: Snapshot) => s.guides.length > 0;
export const hasBoard = (s: Snapshot) =>
  s.userBoard.count > 0 || s.guides.some((g) => g.type === 'stroke');
export function canContinue(s: Snapshot, draft: string) {
  return (
    !!s.session &&
    ['ready', 'waiting'].includes(s.session.phase) &&
    s.input.phase === 'idle' &&
    s.voice.phase === 'idle' &&
    !draft.trim() &&
    s.messages.some((m) => m.role === 'agent')
  );
}
