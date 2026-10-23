import { randomUUID } from 'node:crypto';
import type { AgentPhase, Message, Shot } from '../shared/protocol.ts';

export class Session {
  readonly id = randomUUID();
  readonly token = randomUUID();
  phase: AgentPhase = 'ready';
  messages: Message[] = [];
  private sequence = 0;
  private acknowledged = 0;
  private delivered = 0;
  private clients = new Map<string, Message>();
  private waiter: {
    finish: (value: Message[]) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  topic: string;
  private changed: () => void;
  private now: () => number;
  private activity: number;
  constructor(topic: string, changed: () => void = () => {}, now = Date.now) {
    this.topic = topic;
    this.changed = changed;
    this.now = now;
    this.activity = now();
  }
  refreshConnection() {
    if (this.waiter || this.phase === 'ended' || this.phase === 'offline') return;
    const grace = this.phase === 'thinking' ? 300_000 : 15_000;
    if (this.now() - this.activity >= grace) {
      this.phase = 'offline';
      this.changed();
    }
  }
  get pending() {
    return this.messages.filter((m) => m.role === 'user' && m.id > this.acknowledged);
  }
  say(text: string) {
    if (this.phase === 'ended') throw new Error('教学已结束');
    const m: Message = { id: ++this.sequence, role: 'agent', text, at: Date.now(), shots: [] };
    this.messages.push(m);
    this.activity = this.now();
    this.phase = 'ready';
    this.changed();
    return m;
  }
  append(text: string) {
    if (this.phase === 'ended') throw new Error('教学已结束');
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'agent') throw new Error('没有可追加的 Agent 消息');
    if (last.text.length + text.length > 16000) throw new Error('追加后超过单条消息 16000 字上限');
    last.text += text;
    this.activity = this.now();
    this.phase = 'ready';
    this.changed();
    return last;
  }
  push(text: string, shots: Shot[], clientId: string) {
    if (this.phase === 'ended') throw new Error('教学已结束');
    const prior = this.clients.get(clientId);
    if (prior) return prior;
    const m: Message = { id: ++this.sequence, role: 'user', text, shots, at: Date.now() };
    this.clients.set(clientId, m);
    this.messages.push(m);
    if (this.waiter) this.finish(this.pending);
    this.changed();
    return m;
  }
  ack(id: number) {
    if (!Number.isSafeInteger(id) || id > this.delivered) throw new Error('不能确认尚未交付的消息');
    this.acknowledged = Math.max(this.acknowledged, id);
    this.changed();
  }
  async wait(timeoutMs: number, signal?: AbortSignal): Promise<Message[]> {
    if (this.phase === 'ended') return [];
    if (this.waiter) throw new Error('已有 wait 正在等待');
    if (signal?.aborted) throw new Error('wait aborted');
    this.activity = this.now();
    this.phase = 'waiting';
    this.changed();
    if (this.pending.length) {
      const messages = this.pending;
      this.markDelivered(messages);
      this.phase = 'thinking';
      this.changed();
      return messages;
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!this.waiter) return;
        clearTimeout(this.waiter.timer);
        this.waiter = null;
        this.activity = this.now();
        this.phase = 'ready';
        this.changed();
        reject(new Error('wait aborted'));
      };
      this.waiter = {
        finish: (messages) => {
          signal?.removeEventListener('abort', abort);
          resolve(messages);
        },
        timer: setTimeout(() => this.finish([]), timeoutMs),
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  private markDelivered(messages: Message[]) {
    for (const m of messages) this.delivered = Math.max(this.delivered, m.id);
  }
  private finish(messages: Message[]) {
    const waiter = this.waiter;
    if (!waiter) return;
    this.waiter = null;
    clearTimeout(waiter.timer);
    this.markDelivered(messages);
    this.activity = this.now();
    if (this.phase !== 'ended') this.phase = messages.length ? 'thinking' : 'ready';
    waiter.finish(messages);
    this.changed();
  }
  end() {
    this.phase = 'ended';
    this.finish([]);
    this.changed();
  }
}
