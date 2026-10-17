import { randomUUID } from 'node:crypto';
import type { Shot, Snapshot } from '../shared/protocol.ts';
type InputState = Snapshot['input'];
interface Ports {
  remember(): Promise<string | null>;
  capture(): Promise<Shot | null>;
  focus(): Promise<void>;
  restore(handle: string | null): Promise<void>;
  deliver(text: string, shots: Shot[], clientId: string, attachBoard: boolean): Promise<void>;
  changed(): void;
}
export class InputController {
  state: InputState = { phase: 'idle', turnId: null, error: null };
  private generation = 0;
  private shot: Shot | null = null;
  private original: string | null = null;
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  async prepare(focus = true) {
    if (this.state.phase === 'editing') return this.state.turnId!;
    if (['preparing', 'submitting'].includes(this.state.phase)) throw new Error('输入仍在处理中');
    const gen = ++this.generation;
    const id = randomUUID();
    this.state = { phase: 'preparing', turnId: id, error: null };
    this.shot = null;
    this.ports.changed();
    try {
      const original = await this.ports.remember();
      if (gen !== this.generation) throw new Error('输入已取消');
      this.original = original;
      const shot = await this.ports.capture();
      if (gen !== this.generation) throw new Error('输入已取消');
      this.shot = shot;
      if (focus) await this.ports.focus();
      if (gen !== this.generation) throw new Error('输入已取消');
      this.state = { phase: 'editing', turnId: id, error: null };
      this.ports.changed();
      return id;
    } catch (e) {
      if (gen === this.generation) {
        this.state = { phase: 'failed', turnId: id, error: String((e as Error).message) };
        this.ports.changed();
      }
      throw e;
    }
  }
  async submit(id: string, text: string, attachBoard: boolean) {
    if (this.state.phase !== 'editing' || id !== this.state.turnId)
      throw new Error('输入已失效，请重新开始');
    const gen = this.generation;
    const original = this.original;
    this.state = { phase: 'submitting', turnId: id, error: null };
    this.ports.changed();
    try {
      await this.ports.deliver(text, this.shot ? [this.shot] : [], id, attachBoard);
      if (gen !== this.generation) return;
      this.reset();
      await this.ports.restore(original);
    } catch (e) {
      if (gen === this.generation) {
        this.state = { phase: 'editing', turnId: id, error: (e as Error).message };
        this.ports.changed();
      }
      throw e;
    }
  }
  async cancel() {
    const original = this.original;
    ++this.generation;
    this.reset();
    await this.ports.restore(original);
  }
  private reset() {
    this.original = null;
    this.shot = null;
    this.state = { phase: 'idle', turnId: null, error: null };
    this.ports.changed();
  }
}
