import fs from 'node:fs';
import path from 'node:path';
const errors = [];
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(file);
      continue;
    }
    if (!/\.tsx?$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const relative = file.replaceAll('\\', '/');
    const imports = [...text.matchAll(/(?:from\s*|import\s*\(|require\s*\()(['"])([^'"]+)\1/g)].map(
      (m) => m[2],
    );
    for (const specifier of imports) {
      if (
        relative.startsWith('src/core/') &&
        /electron|react|\/host\/|\/renderer\//.test(specifier)
      )
        errors.push(`${relative}: forbidden domain dependency ${specifier}`);
      if (
        relative.startsWith('src/renderer/') &&
        /^(node:|electron$)|\/host\/|\/core\//.test(specifier)
      )
        errors.push(`${relative}: forbidden renderer dependency ${specifier}`);
      if (
        relative.startsWith('src/shared/') &&
        /electron|react|\/host\/|\/renderer\/|\/core\//.test(specifier)
      )
        errors.push(`${relative}: forbidden shared dependency ${specifier}`);
    }
    if (relative.startsWith('src/renderer/') && /ipcRenderer|require\s*\(/.test(text))
      errors.push(`${relative}: renderer cannot expose raw IPC or require`);
  }
}
visit('src');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('Architecture boundaries OK.');
