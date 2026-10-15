// Every display the OS enumerates is eligible, virtual or not. It is selectable
// only when a capture succeeds and a positive scale factor is known.

function inspectDisplay(display, probe) {
  const bounds = display && display.bounds;
  const scaleFactor = display && Number(display.scaleFactor);
  const scaleOk = Number.isFinite(scaleFactor) && scaleFactor > 0;
  const boundsOk =
    !!bounds &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    bounds.width > 0 &&
    bounds.height > 0;
  const captureOk = !!(probe && probe.captureOk);
  let supported = true;
  let reason = '';
  if (!scaleOk || !boundsOk) {
    supported = false;
    reason = 'no-scale';
  } else if (!captureOk) {
    supported = false;
    reason = 'no-capture';
  }
  return {
    id: display ? display.id : null,
    bounds: boundsOk ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
    scaleFactor: scaleOk ? scaleFactor : null,
    supported,
    reason,
    label: supported ? '' : '不支持',
  };
}

function selectableDisplays(list) {
  return (list || []).filter((d) => d && d.supported);
}

module.exports = { inspectDisplay, selectableDisplays };
