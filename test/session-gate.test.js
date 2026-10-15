const test = require('node:test');
const assert = require('node:assert/strict');
const { decideStart, decideAttach, DECISION_MS } = require('../lib/session-gate');

test('launcher with no lesson connects without consent', () => {
  const d = decideStart({ launchedApp: true, hasActiveSession: false });
  assert.equal(d.action, 'create');
  assert.equal(d.consent, 'waived');
});

test('the connected agent can start again without a new prompt', () => {
  const d = decideStart({ hasActiveSession: true, holdsConnection: true });
  assert.equal(d.action, 'reuse');
});

test('a new start is denied while a lesson is active', () => {
  const d = decideStart({ hasActiveSession: true, launchedApp: false, holdsConnection: false });
  assert.equal(d.action, 'deny');
  assert.equal(d.reason, 'session-active');
});

test('start against an already-open app with no lesson asks the user', () => {
  const d = decideStart({ launchedApp: false, hasActiveSession: false });
  assert.equal(d.action, 'prompt');
  assert.equal(d.defaultDecision, 'deny');
  assert.equal(d.timeoutMs, DECISION_MS);
});

test('attach requires a matching session and a user allow', () => {
  assert.equal(decideAttach({ sessionMatches: false, decision: 'allow' }).action, 'deny');
  assert.equal(decideAttach({ sessionMatches: true, hasActiveSession: true }).action, 'prompt');
  assert.equal(decideAttach({ sessionMatches: true, hasActiveSession: true }).defaultDecision, 'deny');
  assert.equal(decideAttach({ sessionMatches: true, hasActiveSession: true, decision: 'allow' }).action, 'allow');
});

test('an unanswered attach denies, and an active lesson says why', () => {
  const active = decideAttach({ sessionMatches: true, hasActiveSession: true, timedOut: true });
  assert.equal(active.action, 'deny');
  assert.equal(active.reason, 'session-active');
  const idle = decideAttach({ sessionMatches: true, hasActiveSession: false, decision: 'deny' });
  assert.equal(idle.reason, 'denied');
});
