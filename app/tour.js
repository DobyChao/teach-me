// Internal first-run guide. It drives the real say/show path as a fake agent.
// Not part of the public skill.

const STEPS = [
  {
    say: '按住说话，点一下打字。语音在开始说的时候截屏，文字在输入框打开之前截屏。',
    pattern: 'keys',
    keys: ['Ctrl', 'Alt', 'W'],
    label: '按住说话，点一下打字',
    shot: 'screen',
  },
  {
    say: '画板一直在这块屏幕上。平时点得穿，进入编辑才画，Esc 退出。你的笔迹和我的指引分开清。',
    pattern: 'point',
    to: [220, 180],
    label: '平时点得穿，编辑时才画',
    shot: 'screen',
  },
  {
    say: '指引挡住操作时，先藏起来。藏的是我的指引，不是你的笔迹。',
    pattern: 'keys',
    keys: ['Ctrl', 'Alt', 'H'],
    label: '隐藏指引',
    shot: 'screen',
  },
];

function createTour({ show, onStep, onDone }) {
  let index = -1;
  let running = false;
  return {
    get running() {
      return running;
    },
    get step() {
      return running ? index + 1 : 0;
    },
    get total() {
      return STEPS.length;
    },
    start() {
      running = true;
      index = -1;
      this.next();
    },
    next() {
      if (!running) return;
      index += 1;
      if (index >= STEPS.length) {
        running = false;
        onDone('done');
        return;
      }
      const step = STEPS[index];
      onStep({ step: index + 1, total: STEPS.length });
      Promise.resolve(show({ ...step, say: step.say })).catch(() => {});
    },
    skip() {
      if (!running) return;
      running = false;
      onDone('skip');
    },
    abort() {
      running = false;
    },
  };
}

module.exports = { STEPS, createTour };
