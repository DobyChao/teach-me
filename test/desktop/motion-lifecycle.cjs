const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async ({ panel, state, perform, mode, settled, home }) => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => panel.webContents.executeJavaScript(code);
  const results = [];
  await perform({ type: 'panel-context', hasDraft: false, toolsOpen: false, reducedMotion: false });
  await mode('conversation');
  await perform({ type: 'panel-mode', mode: 'compose' });
  await pause(40);
  const motion = (await state()).panelTransition;
  assert.ok(motion, 'shrink transition is active for the handoff probe');
  // Hold the completed animation while deliberately resizing the real native viewport first.
  await js(
    'for(const a of document.getAnimations()){a.pause();a.currentTime=a.effect.getComputedTiming().endTime;}true',
  );
  const envelope = panel.getBounds();
  panel.setBounds({
    x: envelope.x + motion.to.x,
    y: envelope.y + motion.to.y,
    width: motion.to.width,
    height: motion.to.height,
  });
  await pause(30);
  const held = await js(
    '(()=>{const f=document.querySelector(".panel-frame");const b=f.getBoundingClientRect();return {width:b.width,height:b.height,base:f.offsetWidth,transform:getComputedStyle(f).transform}})()',
  );
  results.push({
    test: 'native-final-before-renderer-cleanup',
    target: motion.to,
    observed: held,
    passed:
      Math.abs(held.width - motion.to.width) <= 1 && Math.abs(held.height - motion.to.height) <= 1,
  });
  await perform({ type: 'panel-motion-end', id: motion.id });
  await settled();
  await mode('compose');
  const before = panel.getBounds();
  const version = (await state()).panelLayoutVersion;
  const id = require('node:crypto').randomUUID();
  await perform({ type: 'panel-drag', phase: 'start', dragId: id, dx: 0, dy: 0 });
  const draggingVersion = (await state()).panelLayoutVersion;
  await perform({
    type: 'resize',
    mode: 'compose',
    height: before.height + 96,
    layoutVersion: draggingVersion,
  });
  for (let i = 1; i <= 4; i++)
    await perform({ type: 'panel-drag', phase: 'move', dragId: id, dx: i * 5, dy: 0 });
  await perform({ type: 'panel-drag', phase: 'end', dragId: id, dx: 20, dy: 0 });
  const after = panel.getBounds();
  await perform({
    type: 'resize',
    mode: 'compose',
    height: before.height + 96,
    layoutVersion: version,
  });
  assert.deepEqual(panel.getBounds(), after, 'pre-drag measurement remains stale after release');
  await perform({
    type: 'resize',
    mode: 'compose',
    height: before.height + 96,
    layoutVersion: draggingVersion,
  });
  assert.deepEqual(
    panel.getBounds(),
    after,
    'measurement queued during drag remains stale after release',
  );
  results.push({
    test: 'measurement-while-dragging',
    before,
    after,
    passed:
      Math.abs(after.width - before.width) <= 1 &&
      Math.abs(after.height - before.height) <= 1 &&
      !(await state()).panelAnimating,
  });
  await settled();
  for (const name of ['mini', 'compose', 'conversation']) {
    await mode(name);
    const initial = panel.getBounds();
    const samples = [];
    for (let gesture = 0; gesture < 4; gesture++) {
      const dragId = require('node:crypto').randomUUID();
      await perform({ type: 'panel-drag', phase: 'start', dragId, dx: 0, dy: 0 });
      for (let i = 1; i <= 6; i++) {
        await perform({ type: 'panel-drag', phase: 'move', dragId, dx: -i * 2, dy: -i * 2 });
        samples.push({ ...panel.getBounds(), animating: (await state()).panelAnimating });
      }
      await perform({ type: 'panel-drag', phase: 'end', dragId, dx: -12, dy: -12 });
      samples.push({ ...panel.getBounds(), animating: (await state()).panelAnimating });
    }
    results.push({
      test: name + '-continuous-drag',
      before: initial,
      after: panel.getBounds(),
      passed: samples.every(
        (b) =>
          Math.abs(b.width - initial.width) <= 1 &&
          Math.abs(b.height - initial.height) <= 1 &&
          !b.animating,
      ),
    });
  }
  // Include the frames after normal completion, where the old test stopped collecting.
  for (const name of ['compose', 'mini', 'conversation', 'compose']) {
    await js(
      'window.__handoffFrames=[];window.__sampleHandoff=true;requestAnimationFrame(function frame(){if(!window.__sampleHandoff)return;const b=document.querySelector(".panel-frame").getBoundingClientRect();window.__handoffFrames.push({width:b.width,height:b.height,opacity:getComputedStyle(document.querySelector(".panel")).opacity});requestAnimationFrame(frame)});true',
    );
    await mode(name);
    await pause(100);
    await js('window.__sampleHandoff=false;true');
    const frames = await js('window.__handoffFrames');
    const last = frames.slice(-6);
    results.push({
      test: name + '-post-completion-frames',
      passed:
        last.length === 6 &&
        last.every(
          (b) =>
            Math.abs(b.width - last[0].width) <= 1 &&
            Math.abs(b.height - last[0].height) <= 1 &&
            Number(b.opacity) === 1,
        ),
    });
  }
  await fs.writeFile(path.join(home, 'motion-lifecycle.json'), JSON.stringify(results, null, 2));
  assert.equal(
    results.every((r) => r.passed),
    true,
    JSON.stringify(results),
  );
};
