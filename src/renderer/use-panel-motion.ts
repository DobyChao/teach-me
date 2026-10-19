import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Action, Snapshot } from '../shared/protocol.ts';

export function usePanelMotion(
  state: Snapshot | null,
  panel: RefObject<HTMLElement | null>,
  act: (a: Action) => void,
) {
  const frame = useRef<HTMLDivElement>(null);
  const motion = state?.panelTransition;
  useLayoutEffect(() => {
    const background = frame.current;
    const content = panel.current;
    if (!background || !content || !motion) return;
    const transform = (b: typeof motion.from) =>
      `translate(${b.x}px, ${b.y}px) scale(${b.width / motion.width}, ${b.height / motion.height})`;
    const options = {
      duration: motion.duration,
      easing: 'cubic-bezier(0.333333, 1, 0.666667, 1)',
      fill: 'both' as const,
    };
    const shape = background.animate(
      [
        {
          transform: transform(motion.from),
          borderRadius: motion.from.width <= 121 ? '24px' : '14px',
        },
        { transform: transform(motion.to), borderRadius: motion.to.width <= 121 ? '24px' : '14px' },
      ],
      options,
    );
    const inset = (n: number) => `${Math.max(0, n)}px`;
    const reveal = content.animate(
      [
        {
          opacity: 0.25,
          clipPath: `inset(${inset(motion.from.y - motion.to.y)} ${inset(motion.to.x + motion.to.width - motion.from.x - motion.from.width)} ${inset(motion.to.y + motion.to.height - motion.from.y - motion.from.height)} ${inset(motion.from.x - motion.to.x)} round 14px)`,
        },
        { opacity: 1, clipPath: 'inset(0 round 14px)' },
      ],
      options,
    );
    let cancelled = false;
    shape.finished
      .then(() => {
        if (!cancelled) act({ type: 'panel-motion-end', id: motion.id });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      shape.cancel();
      reveal.cancel();
    };
  }, [motion?.id, act, panel]);
  return {
    frame,
    panelStyle: motion
      ? {
          width: motion.to.width,
          right: motion.width - motion.to.x - motion.to.width,
          bottom: motion.height - motion.to.y - motion.to.height,
        }
      : undefined,
  };
}
