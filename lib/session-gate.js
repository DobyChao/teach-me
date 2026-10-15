// Single on-screen session. The agent that launched the app connects without
// a prompt. Every other attach needs a user decision. When a lesson is already
// active, an unanswered decision denies the new connection.
//
// Ambiguity (see PR): the notes don't set a consent-timeout length. Idle and
// active prompts both resolve to deny at DECISION_MS so the CLI can return.

const DECISION_MS = 15000;

function decideStart({ launchedApp = false, hasActiveSession = false, holdsConnection = false } = {}) {
  if (hasActiveSession && (holdsConnection || launchedApp)) {
    return { action: 'reuse', consent: holdsConnection ? 'existing' : 'waived' };
  }
  if (!hasActiveSession && launchedApp) {
    return { action: 'create', consent: 'waived' };
  }
  if (hasActiveSession) {
    return { action: 'deny', reason: 'session-active', consent: 'denied' };
  }
  return { action: 'prompt', consent: 'required', defaultDecision: 'deny', timeoutMs: DECISION_MS };
}

function decideAttach({ sessionMatches = false, hasActiveSession = false, decision = null, timedOut = false } = {}) {
  if (!sessionMatches) return { action: 'deny', reason: 'no-session', consent: 'denied' };
  if (decision === 'allow') return { action: 'allow', consent: 'granted' };
  if (decision === 'deny' || timedOut) {
    return {
      action: 'deny',
      reason: hasActiveSession ? 'session-active' : 'denied',
      consent: 'denied',
    };
  }
  return {
    action: 'prompt',
    consent: 'required',
    defaultDecision: 'deny',
    emphasizeDefault: !!hasActiveSession,
    timeoutMs: DECISION_MS,
  };
}

module.exports = { DECISION_MS, decideStart, decideAttach };
