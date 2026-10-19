const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const skillModule = import('../bin/skill.mjs');
const bin = path.resolve('bin/teach-me.mjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tma-skill-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('tma-skill-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const run = (...args) =>
    spawnSync(process.execPath, [bin, ...args], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, CODEX_HOME: root, TEACH_ME_AGENT_HOME: path.join(root, 'app-data') },
    });
  return { root, run, destination: path.join(root, 'skills', 'teach-me') };
}

test('CLI help, version and protocol work outside the checkout without launching or configuring the App', (t) => {
  const f = fixture(t);
  for (const args of [['help'], ['--help'], ['start', '--help'], ['--version'], ['protocol']]) {
    const result = f.run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim());
  }
  assert.equal(f.run('--version').stdout.trim(), require('../package.json').version);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('CLI installs into CODEX_HOME, is idempotent and reports its destination from any cwd', (t) => {
  const f = fixture(t);
  assert.equal(JSON.parse(f.run('skill', 'status').stdout).status, 'missing');
  const first = f.run('skill', 'install', '--agent', 'codex');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).changed, true);
  assert.equal(f.run('skill', 'path').stdout.trim(), f.destination);
  assert.equal(JSON.parse(f.run('install-skill').stdout).changed, false);
  assert.equal(JSON.parse(f.run('skill', 'status').stdout).status, 'installed');
  assert.deepEqual(
    fs.readFileSync(path.join(f.destination, 'SKILL.md')),
    fs.readFileSync('skills/teach-me/SKILL.md'),
  );
  assert.equal(fs.existsSync(path.join(f.root, 'app-data')), false);
});

test('explicit skill directory is resolved from the caller and invalid options never fall back to a home install', (t) => {
  const f = fixture(t);
  const result = f.run('skill', 'install', '--skills-dir', 'other skills');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).path, path.join(f.root, 'other skills', 'teach-me'));
  assert.equal(fs.existsSync(f.destination), false);
  for (const args of [
    ['skill', 'install', '--skills-dir'],
    ['skill', 'install', '--agent', 'unknown'],
    ['skill', 'install', '--skils-dir', 'typo'],
    ['skill', 'install', 'unexpected'],
    ['skill', 'delete'],
  ]) {
    assert.equal(f.run(...args).status, 1);
    assert.equal(fs.existsSync(f.destination), false);
  }
});

test('installer updates its unchanged owned skill while preserving unrelated files', async (t) => {
  const f = fixture(t);
  const { installSkill, skillStatus } = await skillModule;
  const source = path.join(f.root, 'source.md');
  const options = { source, destination: f.destination, version: '1' };
  fs.writeFileSync(source, 'version one');
  await installSkill(options);
  fs.writeFileSync(path.join(f.destination, 'personal-notes.md'), 'keep');
  fs.writeFileSync(source, 'version two');
  assert.equal((await skillStatus(options)).status, 'update-available');
  await installSkill({ ...options, version: '2' });
  assert.equal(fs.readFileSync(path.join(f.destination, 'SKILL.md'), 'utf8'), 'version two');
  assert.equal(fs.readFileSync(path.join(f.destination, 'personal-notes.md'), 'utf8'), 'keep');
  assert.equal((await skillStatus(options)).version, '2');
});

test('CLI refuses to replace a foreign skill or a locally edited managed skill', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.destination, { recursive: true });
  const skill = path.join(f.destination, 'SKILL.md');
  fs.writeFileSync(skill, 'foreign skill');
  assert.equal(f.run('skill', 'install').status, 1);
  assert.equal(fs.readFileSync(skill, 'utf8'), 'foreign skill');
  fs.unlinkSync(skill);
  fs.rmdirSync(f.destination);
  assert.equal(f.run('skill', 'install').status, 0);
  fs.appendFileSync(skill, '\nlocal customization');
  assert.equal(JSON.parse(f.run('skill', 'status').stdout).status, 'modified');
  assert.equal(f.run('skill', 'install').status, 1);
  assert.ok(fs.readFileSync(skill, 'utf8').endsWith('local customization'));
});

test('installer refuses a directory junction without altering its target', (t) => {
  const f = fixture(t);
  const target = path.join(f.root, 'other');
  fs.mkdirSync(target);
  fs.mkdirSync(path.dirname(f.destination));
  fs.symlinkSync(target, f.destination, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(f.run('skill', 'install').status, 1);
  assert.deepEqual(fs.readdirSync(target), []);
});
