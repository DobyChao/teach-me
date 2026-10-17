import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Metadata only: never pass user content, credentials or raw exception messages here.
export function writeRuntimeEvent(
  home: string,
  event: string,
  detail: Record<string, string | number | boolean> = {},
) {
  try {
    mkdirSync(home, { recursive: true });
    const file = path.join(home, 'runtime.log');
    try {
      if (statSync(file).size > 128 * 1024) writeFileSync(file, '');
    } catch {}
    appendFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...detail }) + '\n',
      { mode: 0o600 },
    );
  } catch {
    // Diagnostics must not change application lifecycle or mask the original error.
  }
}

export function failureMetadata(error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return {
    name: /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) ? name : 'Error',
    code: /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : '',
  };
}
