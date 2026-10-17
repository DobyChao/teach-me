import { sceneSchema } from '../shared/protocol.ts';
import type { Guide, Scene, Shot } from '../shared/protocol.ts';

export function parseScene(value: unknown): Scene {
  const src = value as Record<string, unknown>;
  if (src && typeof src === 'object' && typeof src.pattern === 'string') {
    const pattern = src.pattern;
    const item =
      pattern === 'point'
        ? { type: 'arrow', to: src.to, label: src.label }
        : pattern === 'highlight'
          ? { type: 'box', rect: src.rect, label: src.label }
          : pattern === 'keys'
            ? { type: 'keys', keys: src.keys }
            : pattern === 'click'
              ? { type: 'click', at: src.at }
              : pattern === 'drag'
                ? { type: 'drag', from: src.from, to: src.to }
                : null;
    if (!item) throw new Error('暂不支持的 pattern');
    return sceneSchema.parse({
      ...src,
      items: [item, ...(Array.isArray(src.items) ? src.items : [])],
    });
  }
  return sceneSchema.parse(value);
}
export function mapGuides(
  scene: Scene,
  shot: Shot,
  current: Shot['bounds'],
  displayId: number,
): Guide[] {
  if (shot.displayId !== displayId || JSON.stringify(shot.bounds) !== JSON.stringify(current))
    throw new Error('屏幕布局已改变，请重新 capture');
  const viewport = shot.crop || { x: 0, y: 0, width: current.width, height: current.height };
  const sx = viewport.width / shot.width,
    sy = viewport.height / shot.height;
  const p = ([x, y]: [number, number]): [number, number] => [
    viewport.x + x * sx,
    viewport.y + y * sy,
  ];
  const r = ([x, y, w, h]: [number, number, number, number]): [number, number, number, number] => [
    viewport.x + x * sx,
    viewport.y + y * sy,
    w * sx,
    h * sy,
  ];
  return scene.items.map((g) => {
    switch (g.type) {
      case 'arrow':
        return { ...g, to: p(g.to), from: g.from ? p(g.from) : undefined };
      case 'box':
      case 'spotlight':
      case 'html':
        return { ...g, rect: r(g.rect) };
      case 'label':
      case 'click':
      case 'step':
      case 'scroll':
        return { ...g, at: p(g.at) };
      case 'stroke':
      case 'path':
        return { ...g, points: g.points.map(p) };
      case 'drag':
        return { ...g, from: p(g.from), to: p(g.to) };
      case 'keys':
        return g;
    }
  });
}
