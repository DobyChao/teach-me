import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { canContinue, hasBoard, hasGuides } from '../shared/protocol.ts';
import { useHost } from './use-host.ts';
import { useMicrophone } from './use-microphone.ts';
import { PanelIcon } from './PanelIcon.tsx';
import { useThreadScroll } from './use-thread-scroll.ts';
import { usePanelMotion } from './use-panel-motion.ts';
const bridge = window.companion;
const phaseLabels = {
  offline: 'Agent 连接待确认，消息会保留',
  ready: '轮到你了',
  waiting: '正在等你回应',
  thinking: 'Agent 正在思考…',
  ended: '这次教学已结束',
};

export function Panel() {
  const { state, failure, perform, act } = useHost();
  useMicrophone(state, act);
  const [draft, setDraft] = useState('');
  const draftVersion = useRef(0);
  const [attach, setAttach] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const [sending, setSending] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeTurn = useRef(state?.input.turnId);
  useLayoutEffect(() => {
    activeTurn.current = state?.input.turnId;
  }, [state?.input.turnId]);
  const panelRef = useRef<HTMLElement>(null);
  const motion = usePanelMotion(state, panelRef, act);
  const thread = useThreadScroll(
    state?.messages || [],
    state?.session?.id,
    !!state && !state.collapsed && !state.panelAnimating,
  );
  const [copiedConnection, setCopiedConnection] = useState(false);
  const preparing = useRef(false);
  const pointer = useRef<{ timer: ReturnType<typeof setTimeout> | null; held: boolean }>({
    timer: null,
    held: false,
  });
  const spoken = useRef<number | null>(null);
  const dragging = useRef<{
    pointer: number;
    id: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const endDrag = () => {
    const drag = dragging.current;
    if (!drag) return;
    dragging.current = null;
    act({ type: 'panel-drag', phase: 'end', dragId: drag.id, dx: drag.dx, dy: drag.dy });
  };
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    act({ type: 'panel-context', hasDraft: !!draft, toolsOpen: showTools, reducedMotion });
  }, [!!draft, showTools, reducedMotion, act]);
  useEffect(() => {
    const last = state?.messages.findLast((m) => m.role === 'agent');
    if (!last || last.id === spoken.current) return;
    spoken.current = last.id;
    if (state?.settings.voice.tts && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(last.text));
    }
  }, [state?.messages, state?.settings.voice.tts]);
  useEffect(
    () => () => {
      if (pointer.current.timer) clearTimeout(pointer.current.timer);
    },
    [],
  );
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }, [draft, state?.panelMode, state?.panelAnimating]);
  useEffect(() => {
    if (!state?.collapsed) setShowTools(false);
  }, [state?.collapsed]);
  useEffect(() => {
    if (state?.panelMode === 'mini') {
      setShowTools(false);
    }
  }, [state?.panelMode]);
  useEffect(() => {
    if (
      state?.input.phase === 'editing' &&
      state.voice.phase === 'idle' &&
      !state.settingsOpen &&
      state.panelMode !== 'mini' &&
      !state.panelAnimating
    )
      inputRef.current?.focus();
  }, [
    state?.input.phase,
    state?.input.turnId,
    state?.voice.phase,
    state?.panelMode,
    state?.panelAnimating,
    state?.settingsOpen,
  ]);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !bridge) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        act({
          type: 'resize',
          layoutVersion: state!.panelLayoutVersion,
          height: Math.ceil(el.getBoundingClientRect().height) + 2,
          mode: el.classList.contains('mode-mini')
            ? 'mini'
            : el.classList.contains('collapsed')
              ? 'compose'
              : 'conversation',
        }),
      );
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [!!state, state?.panelMode, state?.panelLayoutVersion, act]);
  const prepare = async () => {
    if (
      preparing.current ||
      state?.input.phase === 'preparing' ||
      state?.input.phase === 'submitting'
    )
      return;
    preparing.current = true;
    try {
      await perform({ type: 'prepare' });
    } catch {
    } finally {
      preparing.current = false;
    }
  };
  const submit = async () => {
    if (!state?.input.turnId || !draft.trim() || sending) return;
    const submittedVersion = draftVersion.current;
    const submittedTurn = state.input.turnId;
    setSending(true);
    try {
      await perform({
        type: 'submit',
        turnId: state.input.turnId,
        text: draft.trim(),
        attachBoard: attach && hasBoard(state),
      });
      // A late completion owns only the draft it submitted, never a newer edit.
      if (draftVersion.current === submittedVersion) {
        setDraft('');
        if (!activeTurn.current || activeTurn.current === submittedTurn) inputRef.current?.blur();
      }
    } catch {
    } finally {
      setSending(false);
    }
  };
  const openSettings = async () => {
    try {
      await perform({ type: 'settings-focus', on: true });
    } catch {}
  };
  if (!bridge)
    return (
      <div className="browser-notice">
        <h1>Teach me, Agent</h1>
        <p>
          这是桌面应用，请运行 <code>npm run app</code>。
        </p>
        <p>浏览器入口未连接截图、焦点或 Agent，不会模拟这些功能。</p>
      </div>
    );
  if (!state) return <p className="loading">{failure || '正在连接桌面…'}</p>;
  const active = !!state.session && state.session.phase !== 'ended';
  const last = state.messages.findLast((m) => m.role === 'agent')?.text;
  const voiceLabels = {
    idle: '',
    starting: '正在准备语音…',
    recording: '正在听你说话…',
    transcribing: '正在识别…',
    review: '即将发送，可撤回',
  };
  const title =
    state.voice.phase !== 'idle'
      ? state.voice.text || voiceLabels[state.voice.phase]
      : state.session?.phase === 'ended' || state.session?.phase === 'offline'
        ? phaseLabels[state.session.phase]
        : last || (state.session ? phaseLabels[state.session.phase] : '尚未连接 Agent');
  const editable = state.input.phase === 'editing' && state.voice.phase === 'idle';
  const mini = state.panelMode === 'mini';
  return (
    <>
      <div
        className={`panel-frame ${state.panelMode}`}
        style={motion.frameStyle}
        ref={motion.frame}
        aria-hidden="true"
      />
      <section
        ref={panelRef}
        style={{ ...motion.panelStyle, maxHeight: state.panelHeightLimit }}
        className={`panel mode-${state.panelMode} ${state.collapsed ? 'collapsed' : 'expanded'} ${state.panelAnimating ? 'is-switching' : ''}`}
        onMouseEnter={() => act({ type: 'hover', on: true })}
        onMouseLeave={() => act({ type: 'hover', on: false })}
      >
        <header
          className="header"
          title="拖动此处移动面板"
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
            e.preventDefault();
            const id = crypto.randomUUID();
            dragging.current = {
              pointer: e.pointerId,
              id,
              x: e.screenX,
              y: e.screenY,
              dx: 0,
              dy: 0,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
            act({ type: 'panel-drag', phase: 'start', dragId: id, dx: 0, dy: 0 });
          }}
          onPointerMove={(e) => {
            const drag = dragging.current;
            if (!drag || drag.pointer !== e.pointerId) return;
            drag.dx = e.screenX - drag.x;
            drag.dy = e.screenY - drag.y;
            act({ type: 'panel-drag', phase: 'move', dragId: drag.id, dx: drag.dx, dy: drag.dy });
          }}
          onPointerUp={(e) => {
            const drag = dragging.current;
            if (!drag || drag.pointer !== e.pointerId) return;
            drag.dx = e.screenX - drag.x;
            drag.dy = e.screenY - drag.y;
            endDrag();
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onLostPointerCapture={endDrag}
          onPointerCancel={endDrag}
        >
          <span className={`drag-grip ${state.unreadReply ? 'has-unread' : ''}`} aria-hidden="true">
            ⠿
          </span>
          <button
            className="mini-write icon"
            hidden={!mini}
            aria-label="开始输入"
            title={
              state.unreadReply
                ? '开始输入 · 有新回复'
                : draft
                  ? `继续草稿（${state.settings.hotkeys.input}）`
                  : `开始输入（${state.settings.hotkeys.input}）`
            }
            onClick={prepare}
          >
            <PanelIcon name="compose" />
          </button>
          <span
            className={`dot ${state.session?.phase || 'offline'}`}
            title={state.session ? phaseLabels[state.session.phase] : '尚未连接 Agent'}
          />
          <p title={title}>{title}</p>
          {!state.collapsed && (
            <button className="icon" title="设置" aria-label="设置" onClick={openSettings}>
              ⚙
            </button>
          )}
          <button
            className={`icon expand-toggle ${state.unreadReply ? 'has-unread' : ''}`}
            aria-label={state.collapsed ? '展开对话' : '收起对话'}
            title={state.collapsed ? '展开对话' : '收起对话'}
            aria-expanded={!state.collapsed}
            onClick={() => act({ type: 'toggle-expanded' })}
          >
            <PanelIcon name={state.collapsed ? 'expand' : 'collapse'} />
          </button>
          <button
            className="icon minimize-toggle"
            aria-label="收成小胶囊"
            title="收成小胶囊，保留草稿"
            onClick={() => act({ type: 'panel-mode', mode: 'mini' })}
          >
            <PanelIcon name="minimize" />
          </button>
          <button
            className="icon"
            title={active ? '结束教学' : '关闭应用'}
            aria-label={active ? '结束教学' : '关闭应用'}
            onClick={() => act({ type: active ? 'end' : 'quit' })}
          >
            <PanelIcon name="close" />
          </button>
        </header>
        <div className="panel-details" hidden={state.collapsed}>
          {state.selectingDisplay && (
            <div className="request">
              <b>选择这次教学的屏幕</b>
              <div className="display-list">
                {state.displays.map((d) => (
                  <button key={d.id} onClick={() => act({ type: 'select-display', id: d.id })}>
                    {d.label} · {d.width}×{d.height} · {Math.round(d.scaleFactor * 100)}%
                  </button>
                ))}
              </div>
            </div>
          )}
          {state.connection && (
            <div className="request">
              <b>Agent 请求{state.connection.kind === 'attach' ? '加入' : '开始'}教学</b>
              <p>{state.connection.topic || '没有提供主题'}</p>
              <div className="row">
                <button onClick={() => act({ type: 'connection-decision', allow: false })}>
                  拒绝
                </button>
                <button
                  className="primary"
                  onClick={() => act({ type: 'connection-decision', allow: true })}
                >
                  允许连接
                </button>
              </div>
            </div>
          )}
          {state.capture && (
            <div className="request">
              <b>
                {state.capture.phase === 'countdown' ? '即将截屏，可打断' : 'Agent 想看一眼屏幕'}
              </b>
              <div className="row">
                {state.capture.phase === 'countdown' ? (
                  <button onClick={() => act({ type: 'capture-decision', decision: 'interrupt' })}>
                    打断
                  </button>
                ) : (
                  <>
                    <button onClick={() => act({ type: 'capture-decision', decision: 'deny' })}>
                      拒绝
                    </button>
                    <button
                      className="primary"
                      onClick={() => act({ type: 'capture-decision', decision: 'allow' })}
                    >
                      允许截屏
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="thread-pane">
            <div className="thread" ref={thread.ref} onScroll={thread.onScroll} aria-live="polite">
              {(!state.messages.length || !active) && (
                <div className="empty">
                  <span>TEACH ME, AGENT</span>
                  <h1>{active ? '你操作，它来指路。' : '先连接你的 Agent'}</h1>
                  <p>
                    {active
                      ? '教学已连接，在下面问一句即可。'
                      : '把连接说明粘贴给你正在使用的 Agent。连接后，就能在这里提问；也可以先打开画板。'}
                  </p>
                  {!active && (
                    <button
                      className="connect-help"
                      onClick={async () => {
                        try {
                          await perform({ type: 'copy-connect' });
                          setCopiedConnection(true);
                        } catch {}
                      }}
                    >
                      {copiedConnection ? '已复制连接说明' : '复制连接说明'}
                    </button>
                  )}
                </div>
              )}
              {state.messages.map((m) => (
                <div className={`message ${m.role}`} key={m.id}>
                  <p>{m.text}</p>
                  {m.shots.length > 0 && <small>已附 {m.shots.length} 张画面</small>}
                </div>
              ))}
            </div>
            {thread.pending > 0 && (
              <button className="new-messages" onClick={thread.jump}>
                有 {thread.pending} 条新回复 ↓
              </button>
            )}
          </div>
        </div>
        {(failure || state.error || state.input.error || state.voice.error) && (
          <p className="error" role="alert">
            {failure || state.voice.error || state.input.error || state.error}
          </p>
        )}
        {state.voice.phase === 'review' && (
          <div className="voice-review">
            <span>{state.voice.text}</span>
            <button onClick={() => act({ type: 'voice-cancel' })}>撤回</button>
          </div>
        )}
        {!state.collapsed && canContinue(state, draft) && (
          <button className="offer" onClick={() => act({ type: 'continue' })}>
            {state.settings.continueText} ↗
          </button>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            hidden={mini}
            ref={inputRef}
            // Keep space for the header, tools and a scrollable approval in short work areas.
            style={{ maxHeight: Math.max(25, Math.min(120, state.panelHeightLimit - 200)) }}
            aria-label="给 Agent 的消息"
            rows={1}
            readOnly={!editable}
            value={draft}
            placeholder={
              state.input.phase === 'preparing'
                ? '正在准备画面…'
                : !active
                  ? '连接 Agent 后就能发送消息'
                  : state.collapsed
                    ? '问一句…'
                    : '说一句…  Enter 发送，Shift+Enter 换行'
            }
            title="Enter 发送，Shift+Enter 换行"
            onPointerDown={(e) => {
              if (!editable) {
                e.preventDefault();
                prepare();
              }
            }}
            onFocus={() => {
              if (['idle', 'failed'].includes(state.input.phase) && state.voice.phase === 'idle')
                prepare();
            }}
            onChange={(e) => {
              draftVersion.current++;
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                act({ type: 'cancel' });
                inputRef.current?.blur();
              }
            }}
          />
          <div className="tools">
            <button
              type="button"
              className="tool-icon"
              title={`按住说话，点一下打字（${state.settings.hotkeys.input}）`}
              aria-label="按住说话，点一下打字"
              disabled={
                !active || !!draft.trim() || !['idle', 'editing'].includes(state.input.phase)
              }
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                pointer.current.held = false;
                pointer.current.timer = setTimeout(() => {
                  pointer.current.timer = null;
                  pointer.current.held = true;
                  act({ type: 'voice-start' });
                }, 280);
              }}
              onPointerUp={() => {
                if (pointer.current.timer) {
                  clearTimeout(pointer.current.timer);
                  pointer.current.timer = null;
                  prepare();
                } else if (pointer.current.held) {
                  pointer.current.held = false;
                  act({ type: 'voice-stop' });
                }
              }}
              onPointerCancel={() => {
                if (pointer.current.timer) clearTimeout(pointer.current.timer);
                pointer.current.timer = null;
                pointer.current.held = false;
                act({ type: 'voice-cancel' });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  prepare();
                }
              }}
            >
              <PanelIcon name={mini ? 'wave' : 'mic'} />
              <span className="tool-label">
                {state.voice.phase === 'recording' ? '在听…' : '麦克风'}
              </span>
            </button>
            <button
              type="button"
              className="tool-icon"
              aria-label="画板"
              aria-pressed={state.editing}
              title={`打开你的画板：图形、文字、自由画、橡皮与撤销（${state.settings.hotkeys.board} 开关画板）`}
              onClick={() => act({ type: 'edit', on: !state.editing })}
            >
              <PanelIcon name="board" />
              <span className="tool-label">{state.editing ? '正在画' : '画板'}</span>
            </button>
            {state.collapsed && (
              <button
                type="button"
                className="tool-icon"
                aria-label="更多工具"
                title="附件、清理与设置"
                aria-expanded={showTools}
                onClick={() => setShowTools(!showTools)}
              >
                <PanelIcon name="more" />
              </button>
            )}
            <button
              className="send"
              type="submit"
              disabled={!editable || !draft.trim() || sending}
              title="发送（Enter）"
              aria-label="发送"
            >
              <PanelIcon name="send" />
            </button>
          </div>
          <div className="aux-tools" hidden={mini || (state.collapsed && !showTools)}>
            <label className="attach">
              <input
                type="checkbox"
                checked={attach && hasBoard(state)}
                disabled={!hasBoard(state)}
                onChange={(e) => setAttach(e.target.checked)}
              />
              附画板
            </label>
            {state.userBoard.count > 0 && (
              <button type="button" onClick={() => act({ type: 'clear', layer: 'user' })}>
                清笔迹
              </button>
            )}
            {hasGuides(state) && (
              <button type="button" onClick={() => act({ type: 'clear', layer: 'agent' })}>
                清指引
              </button>
            )}
            {(hasGuides(state) || state.guidesHidden) && (
              <button
                type="button"
                title={`指引显隐（${state.settings.hotkeys.guides}）`}
                onClick={() => act({ type: 'toggle-guides' })}
              >
                {state.guidesHidden ? '显示指引' : '隐藏指引'}
              </button>
            )}
            {state.collapsed && (
              <button type="button" onClick={openSettings}>
                设置
              </button>
            )}
          </div>
        </form>
      </section>
    </>
  );
}
