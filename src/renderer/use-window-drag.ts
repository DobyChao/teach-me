import { useRef } from 'react';
import type { PointerEvent } from 'react';
import type { Action } from '../shared/protocol.ts';

export function useWindowDrag(type: 'settings-drag', act: (a: Action) => void) {
  const drag = useRef<{
    pointer: number;
    id: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const end = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    act({ type, phase: 'end', dragId: current.id, dx: current.dx, dy: current.dy });
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (
        event.button !== 0 ||
        (event.target as HTMLElement).closest('button, input, select, textarea, a')
      )
        return;
      event.preventDefault();
      drag.current = {
        pointer: event.pointerId,
        id: crypto.randomUUID(),
        x: event.screenX,
        y: event.screenY,
        dx: 0,
        dy: 0,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      act({ type, phase: 'start', dragId: drag.current.id, dx: 0, dy: 0 });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      current.dx = event.screenX - current.x;
      current.dy = event.screenY - current.y;
      act({ type, phase: 'move', dragId: current.id, dx: current.dx, dy: current.dy });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      current.dx = event.screenX - current.x;
      current.dy = event.screenY - current.y;
      end();
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onLostPointerCapture: end,
    onPointerCancel: end,
  };
}
