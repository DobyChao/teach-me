import fs from 'node:fs/promises';
import path from 'node:path';
export async function pruneSessions(home: string, days: number) {
  if (days <= 0) return;
  const root = path.resolve(home, 'sessions');
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[0-9a-f-]{36}$/i.test(entry.name))
      continue;
    const target = path.resolve(root, entry.name);
    if (path.dirname(target) !== root) continue;
    const realTarget = await fs.realpath(target);
    if (path.dirname(realTarget).toLowerCase() !== realRoot.toLowerCase()) continue;
    const stat = await fs.stat(realTarget);
    if (stat.mtimeMs < Date.now() - days * 86400000)
      await fs.rm(realTarget, { recursive: true, force: true });
  }
}
