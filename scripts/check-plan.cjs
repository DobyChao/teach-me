const fs = require('node:fs');
const path = require('node:path');

function validatePlan(plan, { requirements, acceptance, exists }) {
  const errors = [];
  const states = new Set(['todo', 'in_progress', 'blocked', 'done']);
  if (plan.version !== 1 || !Array.isArray(plan.tasks) || !plan.tasks.length)
    return ['invalid plan version or tasks'];
  const tasks = new Map();
  for (const t of plan.tasks) {
    if (!/^T\d{2}$/.test(t.id) || tasks.has(t.id)) errors.push(`invalid/duplicate task: ${t.id}`);
    tasks.set(t.id, t);
  }
  for (const t of plan.tasks) {
    const fail = (message) => errors.push(`${t.id}: ${message}`);
    if (!t.title || !/^M\d+$/.test(t.milestone || '') || !states.has(t.status))
      fail('invalid title, milestone or status');
    for (const [key, known] of [
      ['requirements', requirements],
      ['acceptance', acceptance],
    ]) {
      if (!Array.isArray(t[key]) || !t[key].length) fail(`missing ${key}`);
      else for (const id of t[key]) if (!known.has(id)) fail(`unknown ${key}: ${id}`);
    }
    if (
      !Array.isArray(t.verify) ||
      !t.verify.length ||
      t.verify.some((v) => typeof v !== 'string' || !v.trim())
    )
      fail('missing verification');
    if (!Array.isArray(t.dependsOn)) fail('missing dependencies');
    for (const id of t.dependsOn || []) {
      if (!tasks.has(id)) fail(`unknown dependency: ${id}`);
      else if (['done', 'in_progress'].includes(t.status) && tasks.get(id).status !== 'done')
        fail(`dependency not done: ${id}`);
    }
    if (!Array.isArray(t.evidence)) fail('missing evidence array');
    for (const file of t.evidence || []) {
      if (
        typeof file !== 'string' ||
        !/^docs\/rebuild\/evidence\/[A-Za-z0-9_.-]+\.md$/.test(file) ||
        !exists(file)
      )
        fail(`invalid/missing evidence: ${file}`);
    }
    if (t.status === 'done' && !t.evidence?.length) fail('done requires evidence');
    if (t.status === 'blocked' && !t.blockedReason?.trim()) fail('blocked requires reason');
  }
  const visiting = new Set();
  const visited = new Set();
  function walk(id) {
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${id}`);
      return;
    }
    if (visited.has(id) || !tasks.has(id)) return;
    visiting.add(id);
    for (const dep of tasks.get(id).dependsOn || []) walk(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) walk(id);
  if (plan.nextUp !== undefined) {
    if (!Array.isArray(plan.nextUp) || !plan.nextUp.length) errors.push('nextUp must be nonempty');
    else {
      const seen = new Set();
      for (const item of plan.nextUp) {
        const id = item?.taskId;
        const task = tasks.get(id);
        if (!task || seen.has(id)) errors.push(`nextUp unknown/duplicate task: ${id}`);
        seen.add(id);
        if (task?.status === 'done') errors.push(`nextUp task already done: ${id}`);
        if (task && task.dependsOn?.some((dep) => tasks.get(dep)?.status !== 'done'))
          errors.push(`nextUp dependency not done: ${id}`);
        if (
          !item ||
          typeof item.reason !== 'string' ||
          !item.reason.trim() ||
          typeof item.action !== 'string' ||
          !item.action.trim()
        )
          errors.push(`nextUp needs reason and action: ${id}`);
      }
    }
  }
  for (const id of requirements)
    if (!plan.tasks.some((t) => t.requirements?.includes(id)))
      errors.push(`unassigned requirement: ${id}`);
  for (const id of acceptance)
    if (!plan.tasks.some((t) => t.acceptance?.includes(id)))
      errors.push(`unassigned acceptance: ${id}`);
  return errors;
}

function readPlan(root) {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const ids = (file, prefix) =>
    new Set(
      [...read(file).matchAll(new RegExp(`^\\| (${prefix}\\d{2}) \\|`, 'gm'))].map((m) => m[1]),
    );
  const plan = JSON.parse(read('docs/rebuild/tasks.json'));
  const errors = validatePlan(plan, {
    requirements: ids('docs/rebuild/PRODUCT.md', 'R'),
    acceptance: ids('docs/rebuild/ACCEPTANCE.md', 'A'),
    exists: (file) => fs.existsSync(path.join(root, file)),
  });
  if (errors.length) throw new Error(errors.join('\n'));
  return plan;
}
if (require.main === module) {
  try {
    const plan = readPlan(path.join(__dirname, '..'));
    console.log(
      `Plan OK: ${plan.tasks.length} tasks; ${plan.tasks.filter((t) => t.status === 'done').length} done.`,
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { validatePlan, readPlan };
