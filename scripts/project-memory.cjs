const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readPlan } = require('./check-plan.cjs');

const output = 'docs/rebuild/CONTEXT.md';
const entryPoints = [
  'AGENTS.md',
  'MEMORY.md',
  'README.md',
  'docs/rebuild/README.md',
  'docs/rebuild/PROGRESS.md',
  'docs/rebuild/ARCHITECTURE.md',
];
const normalize = (text) => text.replace(/\r\n/g, '\n');
const cell = (text) =>
  String(text)
    .replaceAll('|', '\\|')
    .replace(/\s*\n\s*/g, ' ');
const link = (file) => path.posix.relative('docs/rebuild', file);

function checkLinks(root, sources) {
  for (const file of sources) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const resolved = path.resolve(root, path.dirname(file), decodeURIComponent(target));
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw new Error(`${file}: link leaves project: ${target}`);
      if (!fs.existsSync(resolved) && resolved !== path.join(root, output))
        throw new Error(`${file}: missing memory link: ${target}`);
    }
  }
}

function sourceDigest(root) {
  const files = [];
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute) || relative === output) return;
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute)) visit(path.posix.join(relative, name));
    } else files.push(relative);
  }
  // Only repository source trees; never inspect runtime profiles, Git metadata or user data.
  for (const file of [
    'AGENTS.md',
    'MEMORY.md',
    'README.md',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'src',
    'bin',
    'scripts',
    'test',
    'docs',
    '.github',
  ])
    visit(file);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const bytes = fs.readFileSync(path.join(root, file));
    const content = /\.(?:md|json|[cm]?js|tsx?|css|yml|yaml|ps1|svg)$/.test(file)
      ? Buffer.from(normalize(bytes.toString('utf8')))
      : bytes;
    hash.update(file + '\0' + content.length + '\0');
    hash.update(content);
  }
  return hash.digest('hex');
}

function generateContext(root) {
  const plan = readPlan(root);
  checkLinks(root, entryPoints);
  if (!plan.nextUp?.length) throw new Error('项目记忆需要 tasks.json.nextUp 中的优先接续项');
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const lines = [
    '# 当前项目上下文',
    '',
    '> 由 `npm run context` 生成，禁止手改。任务状态仅维护在 tasks.json。',
    '> 用 `npm run context:check` 检查是否过期；旧验证不代表本轮验证或当前运行状态。',
    '',
    '## 恢复入口',
    '',
    '[项目记忆](../../MEMORY.md) · [工程约定](../../AGENTS.md) · [产品规格](PRODUCT.md) · [决策理由](DECISIONS.md) · [架构](ARCHITECTURE.md) · [当前接续](PROGRESS.md) · [验收](ACCEPTANCE.md)',
    '',
    '## 优先接续',
    '',
    '以下排序来自 tasks.json.nextUp；用户新请求可改变排序，动手前先核对工作区。',
    '',
  ];
  for (const [index, item] of plan.nextUp.entries()) {
    const task = byId.get(item.taskId);
    lines.push(
      `### ${index + 1}. ${task.id} · ${task.title}`,
      '',
      `状态：\`${task.status}\`。优先理由：${item.reason}`,
      '',
      `下一步：${item.action}`,
      '',
      `验收入口：${task.acceptance.join('、')}；证据：${
        task.evidence.length
          ? task.evidence.map((file) => `[${path.posix.basename(file)}](${link(file)})`).join('、')
          : '尚无证据文件，完成验证后补入任务引用。'
      }`,
      '',
    );
  }
  lines.push(
    '## 全部任务',
    '',
    '状态为整项验收状态，todo 也可能已有部分实现；不能把完成比例当作产品交付比例。',
    '',
    '| 任务 | 状态 | 依赖 | 证据 |',
    '| --- | --- | --- | --- |',
  );
  for (const task of plan.tasks)
    lines.push(
      `| ${task.id} ${cell(task.title)} | ${task.status} | ${task.dependsOn.join('、') || '—'} | ${task.evidence.map((file) => `[${path.posix.basename(file)}](${link(file)})`).join('、') || '—'} |`,
    );
  lines.push('', '## 尚未完成任务的接续说明', '');
  for (const task of plan.tasks.filter((task) => task.status !== 'done')) {
    lines.push(`- **${task.id}**：${task.notes || '按任务 verify 和验收标准核对实现及缺口。'}`);
    if (task.blockedReason) lines.push(`  阻塞原因：${task.blockedReason}`);
  }
  lines.push(
    '',
    '## 收尾',
    '',
    '更新规格/ADR、tasks.json、证据和当前接续 → `npm run context` → 审阅差异 → `npm run check` → 一起提交。',
    '具体命令和验证边界见 MEMORY.md、README.md 与各任务 verify；不将运行数据写入项目记忆。',
    '',
    `<!-- source-sha256: ${sourceDigest(root)} -->`,
    '',
  );
  return lines.join('\n');
}

function syncContext(root, { check = false } = {}) {
  const expected = generateContext(root);
  const absolute = path.join(root, output);
  if (check) {
    const actual = fs.existsSync(absolute) ? normalize(fs.readFileSync(absolute, 'utf8')) : '';
    if (actual !== expected)
      throw new Error('CONTEXT.md 已过期或缺失；核对源文件后运行 npm run context 并审阅差异。');
  } else fs.writeFileSync(absolute, expected);
  return check ? 'Project memory OK: context and entry links are current.' : `Updated ${output}`;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 1 || args[0] !== '--check'))
      throw new Error('Usage: node scripts/project-memory.cjs [--check]');
    console.log(syncContext(path.join(__dirname, '..'), { check: args[0] === '--check' }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { generateContext, syncContext };
