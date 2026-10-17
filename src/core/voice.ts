import { randomUUID } from 'node:crypto';
export interface VoiceState {
  id: string | null;
  phase: 'idle' | 'starting' | 'recording' | 'transcribing' | 'review';
  text: string;
  error: string | null;
}
interface Ports {
  prepare(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<string>;
  abort(): void;
  submit(text: string): Promise<void>;
  cancel(): Promise<void>;
  changed(): void;
  confirmMs(): number;
}
export class VoiceController {
  state: VoiceState = { id: null, phase: 'idle', text: '', error: null };
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  async start() {
    if (this.state.phase !== 'idle') return;
    const generation = ++this.generation;
    this.state = { id: randomUUID(), phase: 'starting', text: '', error: null };
    this.ports.changed();
    try {
      await this.ports.prepare();
      if (generation !== this.generation) return;
      await this.ports.start();
      if (generation !== this.generation) {
        this.ports.abort();
        return;
      }
      this.state = { ...this.state, phase: 'recording' };
      this.ports.changed();
      this.timer = setTimeout(() => this.stop(), 60000);
    } catch (e) {
      if (generation === this.generation) await this.fail((e as Error).message);
    }
  }
  live(text: string) {
    if (this.state.phase === 'recording') {
      this.state = { ...this.state, text };
      this.ports.changed();
    }
  }
  async stop() {
    if (this.state.phase === 'starting') {
      await this.cancel();
      return;
    }
    if (this.state.phase !== 'recording') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const generation = this.generation;
    this.state = { ...this.state, phase: 'transcribing' };
    this.ports.changed();
    try {
      const text = (await this.ports.stop()).trim();
      if (generation !== this.generation) return;
      if (!text) throw new Error('没有听清，请再试一次');
      this.state = { ...this.state, phase: 'review', text };
      this.ports.changed();
      this.timer = setTimeout(
        () => {
          this.commit(generation).catch((e) => this.fail(e.message));
        },
        Math.max(1000, Math.min(2000, this.ports.confirmMs())),
      );
    } catch (e) {
      if (generation === this.generation) await this.fail((e as Error).message);
    }
  }
  private async commit(generation: number) {
    this.timer = null;
    if (generation !== this.generation) return;
    const text = this.state.text;
    this.state = { ...this.state, phase: 'transcribing' };
    this.ports.changed();
    await this.ports.submit(text);
    if (generation !== this.generation) return;
    this.state = { id: null, phase: 'idle', text: '', error: null };
    this.ports.changed();
  }
  async cancel() {
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ports.abort();
    this.state = { id: null, phase: 'idle', text: '', error: null };
    await this.ports.cancel();
    this.ports.changed();
  }
  async fail(message: string) {
    await this.cancel();
    this.state = { ...this.state, error: message };
    this.ports.changed();
  }
}
