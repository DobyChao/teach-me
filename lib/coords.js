// Agent coordinates are pixels of the screenshot. The app maps them with the
// scale and bounds recorded on that shot. A later scale or layout change is
// stale: prompt and recapture instead of drawing on the wrong grid.

const STALE_PROMPT = '屏幕缩放或位置变了，先重新截一张再画。';

function layoutChanged(recorded, current) {
  if (!recorded || !current) return true;
  const rs = Number(recorded.scaleFactor);
  const cs = Number(current.scaleFactor);
  if (!Number.isFinite(rs) || !Number.isFinite(cs) || Math.abs(rs - cs) > 0.001) return true;
  const a = recorded.bounds || null;
  const b = current.bounds || null;
  if (!a || !b) return true;
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
}

function shotPixelToDip(shot, x, y) {
  const rect = shot.dipRect;
  return {
    x: rect.x + (x * rect.width) / shot.width,
    y: rect.y + (y * rect.height) / shot.height,
  };
}

function shotPixelRectToDip(shot, rect) {
  const [x, y, w, h] = rect;
  const a = shotPixelToDip(shot, x, y);
  const b = shotPixelToDip(shot, x + w, y + h);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

module.exports = { STALE_PROMPT, layoutChanged, shotPixelToDip, shotPixelRectToDip };
