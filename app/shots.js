// Frames are full-resolution captures of one display, kept in memory so the
// agent can zoom into them later. Shots are the images actually handed to the
// agent; each remembers which slice of the screen it covers, so coordinates
// the agent reads off a shot can be mapped back onto the live screen.
const fs = require('fs');
const path = require('path');
const { desktopCapturer, nativeImage, screen } = require('electron');

const MAX_FRAMES = 12;

function fitSize(w, h, maxEdge, maxPixels) {
  const s = Math.min(1, maxEdge / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

function displayInfo(d) {
  return { id: d.id, bounds: { ...d.bounds }, scaleFactor: d.scaleFactor };
}

class Shots {
  constructor({ dir, config }) {
    this.dir = dir;
    this.config = config;
    this.frames = new Map();
    this.shots = new Map();
    this.frameSeq = 0;
    this.shotSeq = 0;
    fs.mkdirSync(dir, { recursive: true });
  }

  async grab(display) {
    const { bounds, scaleFactor } = display;
    const thumbnailSize = {
      width: Math.round(bounds.width * scaleFactor),
      height: Math.round(bounds.height * scaleFactor),
    };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    const src = sources.find((s) => s.display_id === String(display.id)) || (sources.length === 1 ? sources[0] : null);
    if (!src || src.thumbnail.isEmpty()) throw new Error('screen capture failed for display ' + display.id);
    const frame = { id: 'f' + ++this.frameSeq, display: displayInfo(display), image: src.thumbnail, at: Date.now() };
    this.frames.set(frame.id, frame);
    while (this.frames.size > MAX_FRAMES) this.frames.delete(this.frames.keys().next().value);
    return frame;
  }

  // dipRect is in global screen DIP coordinates.
  physicalRect(frame, dipRect) {
    const { bounds } = frame.display;
    const size = frame.image.getSize();
    const rx = size.width / bounds.width;
    const ry = size.height / bounds.height;
    const x = Math.max(0, Math.round((dipRect.x - bounds.x) * rx));
    const y = Math.max(0, Math.round((dipRect.y - bounds.y) * ry));
    const w = Math.min(size.width - x, Math.round(dipRect.width * rx));
    const h = Math.min(size.height - y, Math.round(dipRect.height * ry));
    return { x, y, width: Math.max(1, w), height: Math.max(1, h) };
  }

  save(image, frame, dipRect, role, note) {
    const id = 's' + ++this.shotSeq;
    const src = image.getSize();
    const size = fitSize(src.width, src.height, this.config.maxImageEdge, this.config.maxImagePixels);
    const out = size.width === src.width && size.height === src.height ? image : image.resize({ ...size, quality: 'best' });
    const file = path.join(this.dir, `${id}-${role}.png`);
    fs.writeFileSync(file, out.toPNG());
    const shot = {
      id,
      role,
      note: note || '',
      path: file,
      width: size.width,
      height: size.height,
      frameId: frame.id,
      display: frame.display,
      dipRect: { x: dipRect.x, y: dipRect.y, width: dipRect.width, height: dipRect.height },
      at: Date.now(),
    };
    this.shots.set(id, shot);
    return shot;
  }

  fromFrame(frame, dipRect, role, note) {
    const rect = dipRect || frame.display.bounds;
    const crop = frame.image.crop(this.physicalRect(frame, rect));
    return this.save(crop, frame, rect, role, note);
  }

  fromPng(buffer, frame, dipRect, role, note) {
    const img = nativeImage.createFromBuffer(Buffer.from(buffer));
    if (img.isEmpty()) throw new Error('annotated image was empty');
    return this.save(img, frame, dipRect, role, note);
  }

  get(id) {
    if (id) {
      const shot = this.shots.get(id);
      if (!shot) throw new Error(`unknown shot "${id}"`);
      return shot;
    }
    const last = [...this.shots.values()].pop();
    if (!last) throw new Error('no shots yet: the user has not sent a screen image');
    return last;
  }

  latestFor(frameId) {
    return [...this.shots.values()].filter((s) => s.frameId === frameId);
  }

  // Shot pixel -> global DIP.
  toGlobal(shot, x, y) {
    return {
      x: shot.dipRect.x + (x * shot.dipRect.width) / shot.width,
      y: shot.dipRect.y + (y * shot.dipRect.height) / shot.height,
    };
  }

  // Global DIP -> shot pixel.
  toShot(shot, x, y) {
    return {
      x: ((x - shot.dipRect.x) * shot.width) / shot.dipRect.width,
      y: ((y - shot.dipRect.y) * shot.height) / shot.dipRect.height,
    };
  }

  zoom(shotId, [x, y, w, h]) {
    const shot = this.get(shotId);
    const frame = this.frames.get(shot.frameId);
    if (!frame) throw new Error(`the screen frame behind ${shot.id} is no longer in memory`);
    const a = this.toGlobal(shot, x, y);
    const b = this.toGlobal(shot, x + w, y + h);
    const b0 = frame.display.bounds;
    const rect = {
      x: Math.max(b0.x, Math.min(a.x, b.x)),
      y: Math.max(b0.y, Math.min(a.y, b.y)),
    };
    rect.width = Math.min(b0.x + b0.width, Math.max(a.x, b.x)) - rect.x;
    rect.height = Math.min(b0.y + b0.height, Math.max(a.y, b.y)) - rect.y;
    if (rect.width < 2 || rect.height < 2) throw new Error('zoom rect is outside the image');
    return this.fromFrame(frame, rect, 'zoom', `zoom of ${shot.id} [${[x, y, w, h].map(Math.round).join(',')}]`);
  }

  currentDisplay(display) {
    const d = screen.getAllDisplays().find((x) => x.id === display.id);
    return d || screen.getPrimaryDisplay();
  }
}

module.exports = { Shots, fitSize };
