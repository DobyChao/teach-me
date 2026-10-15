const text = document.getElementById('text');
const bar = document.getElementById('bar');
const fill = document.getElementById('fill');
const interrupt = document.getElementById('interrupt');
const allow = document.getElementById('allow');

function send(decision) {
  tma.send('approval:choice', { decision });
}
allow.addEventListener('click', () => send('allow'));
document.getElementById('deny').addEventListener('click', () => send('deny'));
interrupt.addEventListener('click', () => send('interrupt'));

tma.on('approval:state', (d) => {
  const countdown = d && d.phase === 'countdown';
  bar.hidden = !countdown;
  interrupt.hidden = !countdown;
  allow.hidden = countdown;
  text.textContent = countdown
    ? '即将截屏。打断后回到待审批，不会抢键盘焦点。'
    : 'agent 想看一眼屏幕。允许或拒绝都不会抢走键盘焦点。';
  if (countdown) {
    const ms = d.countdownMs || 3000;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    requestAnimationFrame(() => {
      fill.style.transition = `width ${ms}ms linear`;
      fill.style.width = '100%';
    });
  }
});
