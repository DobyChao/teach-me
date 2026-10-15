// `show` always carries a short say, and replaces the one current scene.

function assertSay(scene) {
  if (!scene || typeof scene.say !== 'string' || !String(scene.say).trim()) {
    throw new Error('show must include a non-empty say');
  }
}

function singleScene(scene) {
  const warnings = [];
  if (scene && scene.keep) warnings.push('one scene at a time; keep is ignored');
  return { replace: true, warnings };
}

module.exports = { assertSay, singleScene };
