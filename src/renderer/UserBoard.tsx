import { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw, MainMenu, exportToCanvas, getCommonBounds } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import type { Action, Snapshot } from '../shared/protocol.ts';
import '@excalidraw/excalidraw/index.css';

export type BoardExporter = (epoch: number) => Promise<HTMLCanvasElement>;
export default function UserBoard({
  state,
  act,
  onExporter,
}: {
  state: Snapshot;
  act: (action: Action) => void;
  onExporter: (exporter: BoardExporter | null) => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);
  const acceptAPI = useCallback((next: ExcalidrawImperativeAPI) => {
    editor.current = next;
    setApi(next);
  }, []);
  const latest = useRef(state);
  latest.current = state;
  const epoch = useRef(state.userBoard.epoch);
  const reported = useRef(-1);
  const changed: NonNullable<ExcalidrawProps['onChange']> = useCallback(
    (elements) => {
      if (epoch.current !== latest.current.userBoard.epoch) return;
      const count = editor.current
        ? editor.current.getSceneElements().length
        : elements.filter((e) => !e.isDeleted).length;
      if (count === reported.current) return;
      reported.current = count;
      act({ type: 'board-change', epoch: epoch.current, count });
    },
    [act],
  );
  useEffect(() => {
    if (!api || epoch.current === state.userBoard.epoch) return;
    epoch.current = state.userBoard.epoch;
    reported.current = -1;
    api.resetScene();
    api.history.clear();
    api.updateScene({
      appState: {
        viewBackgroundColor: 'transparent',
        currentItemStrokeColor: '#e2a23a',
        currentItemFontFamily: 2,
        currentItemRoughness: 0,
      },
    });
  }, [api, state.userBoard.epoch]);
  useEffect(() => {
    if (!api) return;
    const exporter: BoardExporter = async (expectedEpoch) => {
      if (expectedEpoch !== epoch.current) throw new Error('画板已清除，请重新发送');
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const scale = devicePixelRatio;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(innerWidth * scale);
      canvas.height = Math.round(innerHeight * scale);
      if (elements.length) {
        const [x, y, right, bottom] = getCommonBounds(elements);
        if (
          Math.max(right - x, bottom - y) * scale > 16384 ||
          (right - x) * (bottom - y) * scale * scale > 32 * 1024 * 1024
        )
          throw new Error('画板范围太大，请缩小内容范围后重试');
        const image = await exportToCanvas({
          elements,
          appState: { ...appState, exportBackground: false, exportWithDarkMode: true },
          files: api.getFiles(),
          exportPadding: 0,
          getDimensions: (width: number, height: number) => ({ width, height, scale }),
        });
        if (expectedEpoch !== epoch.current) throw new Error('画板已清除，请重新发送');
        const ctx = canvas.getContext('2d')!;
        const zoom = appState.zoom.value;
        ctx.setTransform(scale * zoom, 0, 0, scale * zoom, 0, 0);
        ctx.drawImage(
          image,
          x + appState.scrollX,
          y + appState.scrollY,
          image.width / scale,
          image.height / scale,
        );
      }
      return canvas;
    };
    onExporter(exporter);
    return () => onExporter(null);
  }, [api, onExporter]);
  useEffect(() => {
    if (!api || !state.editing) return;
    api.refresh();
    // Preserve Excalidraw's text/selection Escape behavior before finishing the overlay.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const s = api.getAppState();
      if (s.editingTextElement || s.openDialog || s.openMenu || s.selectedLinearElement) return;
      event.preventDefault();
      act({ type: 'edit', on: false });
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [api, state.editing, act]);
  return (
    <div className={`user-board ${state.editing ? 'editable' : 'viewing'}`}>
      <Excalidraw
        excalidrawAPI={acceptAPI}
        onChange={changed}
        initialData={{
          appState: {
            viewBackgroundColor: 'transparent',
            currentItemStrokeColor: '#e2a23a',
            currentItemFontFamily: 2,
            currentItemRoughness: 0,
            activeTool: { type: 'freedraw', customType: null, locked: false, lastActiveTool: null },
          },
        }}
        langCode="zh-CN"
        theme="dark"
        viewModeEnabled={!state.editing}
        zenModeEnabled={!state.editing}
        gridModeEnabled={false}
        handleKeyboardGlobally={state.editing}
        validateEmbeddable={false}
        aiEnabled={false}
        onLinkOpen={(_element, event) => event.preventDefault()}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
            export: false,
            toggleTheme: false,
          },
        }}
        renderTopRightUI={() => (
          <button className="board-done primary" onClick={() => act({ type: 'edit', on: false })}>
            完成画板
          </button>
        )}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
