export type PanelArea = { x: number; y: number; width: number; height: number };
export type PanelAnchor = { right: number; bottom: number };

// All coordinates are display DIP. Resizing keeps the user's bottom/right anchor.
export function panelBounds(
  height: number,
  collapsed: boolean,
  area: PanelArea,
  anchor?: PanelAnchor | null,
): PanelArea {
  const margin = Math.min(8, Math.floor(Math.min(area.width, area.height) / 4));
  const width = Math.min(collapsed ? 360 : 520, Math.max(1, area.width - margin * 2));
  const h = Math.min(Math.max(64, Math.ceil(height)), Math.max(1, area.height - margin * 2));
  const right = anchor?.right ?? area.x + area.width - margin;
  const bottom = anchor?.bottom ?? area.y + area.height - margin;
  return {
    x: Math.round(
      Math.max(area.x + margin, Math.min(right - width, area.x + area.width - width - margin)),
    ),
    y: Math.round(
      Math.max(area.y + margin, Math.min(bottom - h, area.y + area.height - h - margin)),
    ),
    width,
    height: h,
  };
}
