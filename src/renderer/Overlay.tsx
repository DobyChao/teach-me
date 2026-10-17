import { useEffect, useRef, useState } from 'react';
import type { Guide } from '../shared/protocol.ts';
import { useHost } from './use-host.ts';
function GuideShape({ guide: g }: { guide: Guide }) {
  switch (g.type) {
    case 'arrow': {
      const from = g.from || [Math.max(24, g.to[0] - 130), Math.max(24, g.to[1] - 80)];
      return (
        <g>
          <path d={`M${from[0]},${from[1]} L${g.to[0]},${g.to[1]}`} markerEnd="url(#arrowhead)" />
          {g.label && (
            <text x={from[0]} y={from[1] - 12}>
              {g.label}
            </text>
          )}
        </g>
      );
    }
    case 'box':
      return (
        <g>
          <rect x={g.rect[0]} y={g.rect[1]} width={g.rect[2]} height={g.rect[3]} rx="6" />
          {g.label && (
            <text x={g.rect[0] + 6} y={Math.max(20, g.rect[1] - 10)}>
              {g.label}
            </text>
          )}
        </g>
      );
    case 'spotlight':
      return (
        <path
          d={`M0 0H${innerWidth}V${innerHeight}H0Z M${g.rect[0]} ${g.rect[1]}v${g.rect[3]}h${g.rect[2]}v-${g.rect[3]}Z`}
          fill="#0009"
          fillRule="evenodd"
          stroke="none"
        />
      );
    case 'label':
      return (
        <text x={g.at[0]} y={g.at[1]}>
          {g.text}
        </text>
      );
    case 'keys':
      return (
        <text x="50%" y="85%" textAnchor="middle">
          {g.keys.join(' + ')}
        </text>
      );
    case 'stroke':
    case 'html':
      return null;
    case 'click':
      return (
        <g className="click-guide">
          <circle cx={g.at[0]} cy={g.at[1]} r="17" />
          <circle cx={g.at[0]} cy={g.at[1]} r="5" />
          <text x={g.at[0] + 24} y={g.at[1] + 5}>
            {g.button === 'right'
              ? '右键'
              : g.button === 'double'
                ? '双击'
                : g.button === 'middle'
                  ? '中键'
                  : '点击'}
          </text>
        </g>
      );
    case 'drag':
      return (
        <g>
          <path
            d={`M${g.from[0]} ${g.from[1]}L${g.to[0]} ${g.to[1]}`}
            strokeDasharray="6 5"
            markerEnd="url(#arrowhead)"
          />
          <circle cx={g.from[0]} cy={g.from[1]} r="8" />
        </g>
      );
    case 'path':
      return (
        <polyline
          points={g.points.map((p) => p.join(',')).join(' ')}
          strokeDasharray="6 5"
          markerEnd="url(#arrowhead)"
        />
      );
    case 'step':
      return (
        <g>
          <circle cx={g.at[0]} cy={g.at[1]} r="15" fill="#14161b" />
          <text x={g.at[0]} y={g.at[1] + 5} textAnchor="middle">
            {g.n}
          </text>
          {g.label && (
            <text x={g.at[0] + 22} y={g.at[1] + 5}>
              {g.label}
            </text>
          )}
        </g>
      );
    case 'scroll':
      return (
        <text x={g.at[0]} y={g.at[1]}>
          滚动 {{ up: '↑', down: '↓', left: '←', right: '→' }[g.direction]}
        </text>
      );
  }
}
export function Overlay() {
  const { state, act } = useHost();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stroke, setStroke] = useState<[number, number][]>([]);
  const drawing = useRef<[number, number][] | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;
    const scale = devicePixelRatio;
    canvas.width = innerWidth * scale;
    canvas.height = innerHeight * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.5;
    const draw = (points: [number, number][], color: string) => {
      if (points.length < 2) return;
      ctx.strokeStyle = color;
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
      ctx.stroke();
    };
    state.userInk.forEach((s) => draw(s, '#e2a23a'));
    if (!state.guidesHidden)
      state.guides.forEach((g) => {
        if (g.type === 'stroke') draw(g.points, '#ff3d7f');
      });
    draw(stroke, '#e2a23a');
  }, [state, stroke]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') act({ type: 'edit', on: false });
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [act]);
  if (!state) return null;
  return (
    <div
      className={`overlay ${state.editing ? 'editing' : ''}`}
      onPointerDown={(e) => {
        if (!state.editing) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = [[e.clientX, e.clientY]];
        setStroke(drawing.current);
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        drawing.current = [...drawing.current, [e.clientX, e.clientY]];
        setStroke(drawing.current);
      }}
      onPointerUp={() => {
        if (drawing.current && drawing.current.length > 1)
          act({ type: 'stroke', points: drawing.current });
        drawing.current = null;
        setStroke([]);
      }}
      onPointerCancel={() => {
        drawing.current = null;
        setStroke([]);
      }}
    >
      <canvas data-board ref={canvasRef} />
      {!state.guidesHidden && (
        <svg className="guides">
          <defs>
            <marker
              id="arrowhead"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10" fill="none" />
            </marker>
          </defs>
          {state.guides.map((g, i) => (
            <GuideShape key={i} guide={g} />
          ))}
        </svg>
      )}
      {state.editing && (
        <button
          className="edit-exit"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => act({ type: 'edit', on: false })}
        >
          画板编辑中 · Esc 完成
        </button>
      )}
    </div>
  );
}
