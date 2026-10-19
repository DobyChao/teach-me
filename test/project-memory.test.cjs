const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateContext, syncContext } = require('../scripts/project-memory.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teach-me-memory-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('teach-me-memory-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  for (const file of [
    'AGENTS.md',
    'MEMORY.md',
    'README.md',
    'README.zh-CN.md',
    'INSTALL.md',
    'docs/rebuild/README.md',
    'docs/rebuild/PROGRESS.md',
    'docs/rebuild/ARCHITECTURE.md',
  ])
    write(file, '# Fixture\n');
  write('MEMORY.md', '[Current](docs/rebuild/CONTEXT.md)\n');
  write('docs/rebuild/PRODUCT.md', '| R01 | requirement | source |\n');
  write('docs/rebuild/ACCEPTANCE.md', '| A01 | acceptance | auto |\n');
  write('docs/rebuild/DECISIONS.md', '# Decisions\n');
  write('docs/rebuild/evidence/T00.md', '# Evidence\n');
  write('src/example.ts', 'export const example = 1;\n');
  const plan = {
    version: 1,
    tasks: [
      {
        id: 'T00',
        title: 'recover context',
        milestone: 'M0',
        status: 'in_progress',
        dependsOn: [],
        requirements: ['R01'],
        acceptance: ['A01'],
        verify: ['node check'],
        evidence: ['docs/rebuild/evidence/T00.md'],
        notes: 'Keep unverified cases explicit.',
      },
    ],
    nextUp: [{ taskId: 'T00', reason: 'continuity', action: 'verify from source' }],
  };
  write('docs/rebuild/tasks.json', JSON.stringify(plan));
  return { root, write, plan, read: (file) => fs.readFileSync(path.join(root, file), 'utf8') };
}

test('context bootstraps from repository files and is deterministic across generation and CRLF', (t) => {
  const f = fixture(t);
  const expected = generateContext(f.root);
  assert.match(expected, /T00 · recover context/);
  assert.match(expected, /verify from source/);
  assert.match(expected, /evidence\/T00.md/);
  assert.ok(!expected.includes(f.root));
  syncContext(f.root);
  assert.equal(generateContext(f.root), expected);
  f.write('src/example.ts', f.read('src/example.ts').replaceAll('\n', '\r\n'));
  f.write('docs/rebuild/CONTEXT.md', expected.replaceAll('\n', '\r\n'));
  assert.doesNotThrow(() => syncContext(f.root, { check: true }));
});

test('check rejects missing or edited context without creating or repairing files', (t) => {
  const f = fixture(t);
  assert.throws(() => syncContext(f.root, { check: true }), /过期或缺失/);
  assert.equal(fs.existsSync(path.join(f.root, 'docs/rebuild/CONTEXT.md')), false);
  syncContext(f.root);
  f.write('docs/rebuild/CONTEXT.md', '# hand edited\n');
  assert.throws(() => syncContext(f.root, { check: true }), /过期或缺失/);
  assert.equal(f.read('docs/rebuild/CONTEXT.md'), '# hand edited\n');
});

test('source, task notes and evidence edits each invalidate a previously current context', (t) => {
  const f = fixture(t);
  for (const [file, content] of [
    ['src/example.ts', 'export const example = 2;\n'],
    [
      'docs/rebuild/tasks.json',
      JSON.stringify({ ...f.plan, tasks: [{ ...f.plan.tasks[0], notes: 'new limitation' }] }),
    ],
    ['docs/rebuild/evidence/T00.md', '# Evidence\nNew observed failure.\n'],
    ['scripts/new-check.cjs', 'module.exports = {};\n'],
    ['skills/teach-me/SKILL.md', '---\nname: teach-me\n---\nChanged teaching rule.\n'],
  ]) {
    syncContext(f.root);
    const before = f.read('docs/rebuild/CONTEXT.md');
    f.write(file, content);
    assert.throws(() => syncContext(f.root, { check: true }), /过期或缺失/);
    assert.equal(f.read('docs/rebuild/CONTEXT.md'), before);
  }
});

test('runtime data and Git metadata do not change or leak into project context', (t) => {
  const f = fixture(t);
  syncContext(f.root);
  const before = f.read('docs/rebuild/CONTEXT.md');
  f.write('.runtime/endpoint.json', 'private-runtime-token');
  f.write('.runtime/settings.json', 'private-machine-settings');
  f.write('.git/HEAD', 'new-local-commit');
  assert.doesNotThrow(() => syncContext(f.root, { check: true }));
  assert.equal(generateContext(f.root), before);
  assert.ok(!before.includes('private-runtime-token'));
});

test('broken or escaping entry links fail before generating an apparently current snapshot', (t) => {
  const f = fixture(t);
  f.write('MEMORY.md', '[Missing](docs/does-not-exist.md)');
  assert.throws(() => generateContext(f.root), /missing memory link/);
  f.write('MEMORY.md', '[Escape](../outside.md)');
  assert.throws(() => generateContext(f.root), /leaves project/);
});

test('context cannot be regenerated to hide an invalid priority task', (t) => {
  const f = fixture(t);
  f.write(
    'docs/rebuild/tasks.json',
    JSON.stringify({ ...f.plan, nextUp: [{ ...f.plan.nextUp[0], taskId: 'T99' }] }),
  );
  assert.throws(() => syncContext(f.root), /nextUp unknown/);
});
