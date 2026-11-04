import type { PanelRecoveryState } from '../shared/protocol.ts';

/** Persistent panel copy while a renderer recovery is in progress. */
export const PANEL_RECOVERY_STATUS = '正在恢复';
/** Ctrl+Alt+W feedback. Stays until this recovery attempt ends. */
export const PANEL_RECOVERY_HOTKEY = '正在恢复，稍等';
/** Shown when recovery cancels an in-flight recording. Not a transcript message. */
export const PANEL_RECOVERY_INTERRUPTED = '这句没发出去';
/** Failure path copy. The attempt must not end as a silent non-crash. */
export const PANEL_RECOVERY_FAILURE = '面板恢复失败，请重新打开。';

const PASSIVE_DURING_RECOVERY = new Set(['board-change']);

export class PanelRecoveryController {
  private active = false;
  private generation = 0;
  private attemptedAt = 0;
  private settled = 0;
  private status: string | null = null;
  private hotkeyTip: string | null = null;
  private voiceTip: string | null = null;
  private now: () => number;
  private windowMs: number;

  constructor(now = () => Date.now(), windowMs = 60_000) {
    this.now = now;
    this.windowMs = windowMs;
  }

  get isActive() {
    return this.active;
  }

  get currentGeneration() {
    return this.generation;
  }

  view(): PanelRecoveryState {
    return {
      active: this.active,
      status: this.status,
      hotkeyTip: this.hotkeyTip,
      voiceTip: this.voiceTip,
    };
  }

  /**
   * Start one panel recovery, or refuse when this attempt or the last 60s already used the single retry.
   * A live voice turn records the interrupted-recording copy and must be cancelled by the host, not submitted.
   */
  begin(voiceLive: boolean): 'started' | 'exhausted' {
    const now = this.now();
    if (this.active || (this.attemptedAt !== 0 && now - this.attemptedAt < this.windowMs)) {
      if (this.active) this.settled = this.generation;
      this.status = PANEL_RECOVERY_FAILURE;
      this.hotkeyTip = null;
      this.voiceTip = null;
      // Stay closed to main controls until the host finishes the bounded exit.
      this.active = true;
      return 'exhausted';
    }
    this.generation += 1;
    this.attemptedAt = now;
    this.active = true;
    this.status = PANEL_RECOVERY_STATUS;
    this.hotkeyTip = null;
    this.voiceTip = voiceLive ? PANEL_RECOVERY_INTERRUPTED : null;
    return 'started';
  }

  /**
   * Dangerous main controls are swallowed: they must not quit, end the session, or open the mic.
   * Passive board reports still apply. Layout reports are also swallowed so a reloading document cannot resize over the recovery chrome.
   */
  decide(type: string): 'run' | 'swallow' {
    if (!this.active) return 'run';
    if (PASSIVE_DURING_RECOVERY.has(type)) return 'run';
    return 'swallow';
  }

  /** Record the talk-hotkey tip. Returns true when the caller must not open the microphone. */
  interceptTalk(): boolean {
    if (!this.active) return false;
    this.hotkeyTip = PANEL_RECOVERY_HOTKEY;
    return true;
  }

  complete(generation: number) {
    if (generation !== this.generation || this.settled === generation) return false;
    this.settled = generation;
    this.active = false;
    this.status = null;
    this.hotkeyTip = null;
    this.voiceTip = null;
    return true;
  }

  fail(generation: number) {
    if (generation !== this.generation || this.settled === generation) return false;
    this.settled = generation;
    this.status = PANEL_RECOVERY_FAILURE;
    this.hotkeyTip = null;
    this.voiceTip = null;
    this.active = true;
    return true;
  }

  /** Late IPC and hotkey failures from another attempt must not overwrite the current UI. */
  acceptsCallback(generation: number) {
    return !this.active && generation === this.generation;
  }
}
