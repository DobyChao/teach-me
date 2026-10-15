const text = document.getElementById('text');
const board = document.getElementById('board');
const hint = document.getElementById('hint');

function submit() {
  const value = text.value.trim();
  if (!value) return;
  tma.send('input:submit', { text: value, attachBoard: board.checked && !board.disabled });
  text.value = '';
}

text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Escape') {
    tma.send('input:cancel');
  }
});
document.getElementById('send').addEventListener('click', submit);

tma.on('input:open', (d) => {
  board.disabled = !d || !d.hasBoard;
  board.checked = !!(d && d.attachBoard && d.hasBoard);
  hint.textContent = d && d.shot ? '截图已经在打开之前留下' : '这次不附屏幕';
  text.value = '';
  text.focus();
});
