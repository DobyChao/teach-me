import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

const owner = 'teach-me-agent/teach-me';
const digest = (text) => createHash('sha256').update(text).digest('hex');

export function skillDestination({ skillsDir, codexHome = process.env.CODEX_HOME } = {}) {
  return path.resolve(
    skillsDir || path.join(codexHome || path.join(os.homedir(), '.codex'), 'skills'),
    'teach-me',
  );
}

async function stat(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function skillStatus({ source, destination }) {
  const info = await stat(destination);
  if (!info) return { status: 'missing', path: destination };
  if (!info.isDirectory() || info.isSymbolicLink())
    return { status: 'unmanaged', path: destination };
  const skill = path.join(destination, 'SKILL.md');
  const manifest = path.join(destination, '.tma-skill.json');
  if (!(await stat(skill))?.isFile() || !(await stat(manifest))?.isFile())
    return { status: 'unmanaged', path: destination };
  let installed;
  try {
    installed = JSON.parse(await fs.readFile(manifest, 'utf8'));
  } catch {
    return { status: 'unmanaged', path: destination };
  }
  if (installed?.owner !== owner || installed.schema !== 1)
    return { status: 'unmanaged', path: destination };
  const actual = digest(await fs.readFile(skill));
  const status =
    actual !== installed.sha256
      ? 'modified'
      : actual === digest(await fs.readFile(source))
        ? 'installed'
        : 'update-available';
  return { status, path: destination, version: installed.version };
}

async function replace(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function installSkill({ source, destination, version }) {
  const content = await fs.readFile(source);
  const before = await skillStatus({ source, destination });
  if (['unmanaged', 'modified'].includes(before.status))
    throw new Error(
      `技能目录已有其他内容或本地修改，未覆盖：${destination}。请先自行备份/迁移，或用 --skills-dir 选择另一目录。`,
    );
  if (before.status === 'installed') return { ...before, changed: false };
  if (before.status === 'missing') {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // Exclusive directory creation avoids adopting a concurrently created foreign skill.
    await fs.mkdir(destination);
  }
  await replace(path.join(destination, 'SKILL.md'), content);
  await replace(
    path.join(destination, '.tma-skill.json'),
    JSON.stringify(
      {
        schema: 1,
        owner,
        version,
        sha256: digest(content),
      },
      null,
      2,
    ) + '\n',
  );
  return { status: 'installed', path: destination, version, changed: true };
}
