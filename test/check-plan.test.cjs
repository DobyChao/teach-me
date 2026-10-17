const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan } = require('../scripts/check-plan.cjs');
const task = (id) => ({
  id,
  title: id,
  milestone: 'M0',
  status: 'todo',
  dependsOn: [],
  requirements: ['R01'],
  acceptance: ['A01'],
  verify: ['node check'],
  evidence: [],
});
const options = {
  requirements: new Set(['R01']),
  acceptance: new Set(['A01']),
  exists: (file) => file.endsWith('/T00.md'),
};
const check = (tasks) => validatePlan({ version: 1, tasks }, options);
test('valid plan passes', () => assert.deepEqual(check([task('T00')]), []));
test('rejects unknown references and uncovered requirements', () => {
  const errors = check([{ ...task('T00'), requirements: ['R99'], acceptance: ['A99'] }]);
  assert.ok(errors.some((e) => e.includes('unknown requirements')));
  assert.ok(errors.some((e) => e.includes('unknown acceptance')));
  assert.ok(errors.some((e) => e.includes('unassigned requirement')));
});
test('rejects cycles and unknown dependencies', () => {
  assert.ok(
    check([
      { ...task('T00'), dependsOn: ['T01'] },
      { ...task('T01'), dependsOn: ['T00'] },
    ]).some((e) => e.includes('cycle')),
  );
  assert.ok(
    check([{ ...task('T00'), dependsOn: ['T99'] }]).some((e) => e.includes('unknown dependency')),
  );
});
test('done requires real evidence and completed dependencies', () => {
  assert.ok(
    check([{ ...task('T00'), status: 'done' }]).some((e) => e.includes('requires evidence')),
  );
  assert.ok(
    check([
      { ...task('T00'), status: 'done', evidence: ['docs/rebuild/evidence/missing.md'] },
    ]).some((e) => e.includes('missing evidence')),
  );
  assert.ok(
    check([
      task('T00'),
      {
        ...task('T01'),
        status: 'done',
        dependsOn: ['T00'],
        evidence: ['docs/rebuild/evidence/T00.md'],
      },
    ]).some((e) => e.includes('dependency not done')),
  );
});
test('blocked requires actionable reason and duplicate IDs fail', () => {
  assert.ok(
    check([{ ...task('T00'), status: 'blocked' }]).some((e) => e.includes('requires reason')),
  );
  assert.ok(check([task('T00'), task('T00')]).some((e) => e.includes('duplicate')));
});
