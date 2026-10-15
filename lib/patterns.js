// Preset patterns expand into basic primitives. Free HTML stays an item.
// Unknown patterns warn and add nothing.

function point(scene) {
  if (!scene.to) return { error: 'pattern point needs "to"' };
  return { items: [{ type: 'arrow', to: scene.to, from: scene.from, label: scene.label, shot: scene.shot }] };
}

function highlight(scene) {
  if (!scene.rect) return { error: 'pattern highlight needs "rect"' };
  return { items: [{ type: 'box', rect: scene.rect, label: scene.label, shot: scene.shot }] };
}

function click(scene) {
  if (!scene.at) return { error: 'pattern click needs "at"' };
  return { items: [{ type: 'click', at: scene.at, button: scene.button, label: scene.label, shot: scene.shot }] };
}

function drag(scene) {
  if (!scene.from || !scene.to) return { error: 'pattern drag needs "from" and "to"' };
  return { items: [{ type: 'drag', from: scene.from, to: scene.to, label: scene.label, shot: scene.shot }] };
}

function keys(scene) {
  if (!scene.keys) return { error: 'pattern keys needs "keys"' };
  return { items: [{ type: 'keys', keys: scene.keys, at: scene.at, label: scene.label, shot: scene.shot }] };
}

function steps(scene) {
  if (!Array.isArray(scene.steps) || !scene.steps.length) return { error: 'pattern steps needs "steps"' };
  return {
    items: scene.steps.map((step, i) => ({
      type: 'step',
      at: step.at,
      n: step.n != null ? step.n : i + 1,
      label: step.label,
      delay: step.delay != null ? step.delay : i * 450,
      shot: step.shot || scene.shot,
    })),
  };
}

const PATTERNS = { point, highlight, click, drag, keys, steps };

function expandScene(scene) {
  const warnings = [];
  const base = scene && typeof scene === 'object' ? scene : {};
  const items = Array.isArray(base.items) ? base.items.slice() : [];
  if (base.pattern) {
    const fn = PATTERNS[base.pattern];
    if (!fn) warnings.push(`unknown pattern "${base.pattern}"`);
    else {
      const made = fn(base);
      if (made.error) warnings.push(made.error);
      else items.unshift(...made.items);
    }
  }
  return { scene: { ...base, items }, warnings };
}

module.exports = { PATTERNS, expandScene };
