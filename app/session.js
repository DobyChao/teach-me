// One teaching session: the user's messages queue up here until the agent
// collects them with `wait`. Messages stay queued until the CLI acks them, so
// an agent whose tool call gets killed mid-wait does not lose anything.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const LISTEN_GAP_MS = 90 * 1000;
const THINKING_MS = 20 * 60 * 1000;

class Session extends EventEmitter {
  constructor({ id, dir, topic }) {
    super();
    this.id = id;
    this.dir = dir;
    this.topic = topic || '';
    this.messages = [];
    this.seq = 0;
    this.acked = 0;
    this.waiter = null;
    this.lastWaitEnd = 0;
    this.lastWaitEndReason = null;
    this.lastAgentActivity = 0;
    this.ended = false;
    fs.mkdirSync(dir, { recursive: true });
    this.transcript = path.join(dir, 'transcript.jsonl');
  }

  record(entry) {
    try {
      fs.appendFileSync(this.transcript, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    } catch {}
  }

  push(msg) {
    const m = { id: ++this.seq, at: new Date().toISOString(), ...msg };
    this.messages.push(m);
    this.record({ from: 'user', ...m });
    this.flush();
    this.emit('state');
    return m;
  }

  pending() {
    return this.messages.filter((m) => m.id > this.acked);
  }

  flush() {
    const pending = this.pending();
    if (this.waiter && pending.length) this.finishWait({ messages: pending });
  }

  finishWait(result) {
    const w = this.waiter;
    if (!w) return;
    this.waiter = null;
    clearTimeout(w.timer);
    this.lastWaitEnd = Date.now();
    this.lastWaitEndReason = result.messages ? 'messages' : result.timeout ? 'timeout' : 'other';
    w.resolve(result);
    this.emit('state');
  }

  wait(timeoutMs, onAbort) {
    if (this.waiter) this.finishWait({ superseded: true });
    this.lastAgentActivity = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finishWait({ timeout: true }), timeoutMs);
      this.waiter = { resolve, timer };
      if (onAbort)
        onAbort(() => {
          if (this.waiter && this.waiter.resolve === resolve) this.finishWait({ aborted: true });
        });
      this.emit('state');
      this.flush();
    });
  }

  ack(id) {
    if (id > this.acked) this.acked = Math.min(id, this.seq);
    this.lastAgentActivity = Date.now();
    this.emit('state');
  }

  touch() {
    this.lastAgentActivity = Date.now();
    this.emit('state');
  }

  agentState() {
    const now = Date.now();
    if (this.ended) return 'ended';
    if (this.waiter) return 'listening';
    if (this.lastWaitEndReason === 'timeout' && now - this.lastWaitEnd < LISTEN_GAP_MS) return 'listening';
    if (this.lastAgentActivity && now - this.lastAgentActivity < THINKING_MS && this.lastWaitEndReason === 'messages')
      return 'thinking';
    if (this.lastAgentActivity && now - this.lastAgentActivity < LISTEN_GAP_MS) return 'thinking';
    return 'offline';
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.push({ kind: 'end', source: 'panel', text: '', shots: [] });
  }

  close(reason) {
    this.ended = true;
    if (this.waiter) this.finishWait({ closed: true, reason });
  }
}

module.exports = { Session };
