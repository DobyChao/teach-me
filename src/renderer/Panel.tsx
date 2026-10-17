import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { canContinue, hasBoard, hasGuides } from '../shared/protocol.ts';
import { useHost } from './use-host.ts';
import { useMicrophone } from './use-microphone.ts';
import { SettingsView } from './SettingsView.tsx';
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
  const [attach, setAttach] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const preparing = useRef(false);
  const pointer = useRef<{ timer: ReturnType<typeof setTimeout> | null; held: boolean }>({
    timer: null,
    held: false,
  });
  const spoken = useRef<number | null>(null);
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
  }, [draft]);
  useEffect(() => {
    if (state?.input.phase === 'editing' && state.voice.phase === 'idle') inputRef.current?.focus();
  }, [state?.input.phase, state?.input.turnId, state?.voice.phase]);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [state?.messages.length]);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !bridge) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        act({ type: 'resize', height: Math.ceil(el.getBoundingClientRect().height) + 2 }),
      );
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [!!state, act]);
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
    setSending(true);
    try {
      await perform({
        type: 'submit',
        turnId: state.input.turnId,
        text: draft.trim(),
        attachBoard: attach && hasBoard(state),
      });
      setDraft('');
      inputRef.current?.blur();
    } catch {
    } finally {
      setSending(false);
    }
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
        : last || (state.session ? phaseLabels[state.session.phase] : phaseLabels.offline);
  const editable = state.input.phase === 'editing' && state.voice.phase === 'idle';
  return (
    <section
      ref={panelRef}
      className={`panel ${state.collapsed ? 'collapsed' : 'expanded'}`}
      onMouseEnter={() => act({ type: 'hover', on: true })}
      onMouseLeave={() => act({ type: 'hover', on: false })}
    >
      <header className="header">
        <span
          className={`dot ${state.session?.phase || 'offline'}`}
          title={state.session ? phaseLabels[state.session.phase] : phaseLabels.offline}
        />
        <p title={title}>{title}</p>
        {!state.collapsed && (
          <button
            className="icon"
            title="设置"
            aria-label="设置"
            onClick={() => {
              act({ type: 'settings-focus', on: !showSettings });
              setShowSettings(!showSettings);
            }}
          >
            ⚙
          </button>
        )}
        <button
          className="icon"
          title={active ? '结束教学' : '关闭应用'}
          aria-label={active ? '结束教学' : '关闭应用'}
          onClick={() => act({ type: active ? 'end' : 'quit' })}
        >
          ×
        </button>
      </header>
      <div hidden={state.collapsed}>
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
            <b>{state.capture.phase === 'countdown' ? '即将截屏，可打断' : 'Agent 想看一眼屏幕'}</b>
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
        {showSettings ? (
          <SettingsView
            state={state}
            act={act}
            onClose={() => {
              setShowSettings(false);
              act({ type: 'settings-focus', on: false });
            }}
          />
        ) : (
          <div className="thread" ref={threadRef} aria-live="polite">
            {!state.messages.length && (
              <div className="empty">
                <span>TEACH ME, AGENT</span>
                <h1>你操作，它来指路。</h1>
                <p>
                  先在你的 Agent 里开始一次教学，
                  <br />
                  然后在这里问一句。
                </p>
              </div>
            )}
            {state.messages.map((m) => (
              <div className={`message ${m.role}`} key={m.id}>
                <p>{m.text}</p>
                {m.shots.length > 0 && <small>已附 {m.shots.length} 张画面</small>}
              </div>
            ))}
          </div>
        )}
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
      {!state.collapsed && !showSettings && canContinue(state, draft) && (
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
          ref={inputRef}
          aria-label="给 Agent 的消息"
          rows={1}
          readOnly={!editable}
          value={draft}
          placeholder={
            state.input.phase === 'preparing'
              ? '正在准备画面…'
              : '说一句…  Enter 发送，Shift+Enter 换行'
          }
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
          onChange={(e) => setDraft(e.target.value)}
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
            title="按住说话，点一下打字（Ctrl+Alt+W）"
            aria-label="按住说话，点一下打字"
            disabled={!active || !!draft.trim() || !['idle', 'editing'].includes(state.input.phase)}
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
            {state.voice.phase === 'recording' ? '在听…' : '麦克风'}
          </button>
          <button
            type="button"
            aria-pressed={state.editing}
            title="打开你的画板：图形、文字、自由画、橡皮与撤销"
            onClick={() => act({ type: 'edit', on: !state.editing })}
          >
            {state.editing ? '正在画' : '画板'}
          </button>
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
              title="指引显隐（Ctrl+Alt+H）"
              onClick={() => act({ type: 'toggle-guides' })}
            >
              {state.guidesHidden ? '显示指引' : '隐藏指引'}
            </button>
          )}
          <span className="spacer" />
          <button
            type="button"
            aria-expanded={!state.collapsed}
            onClick={() => act({ type: 'toggle-expanded' })}
          >
            {state.collapsed ? '展开' : '收起'}
          </button>
          <button
            className="send"
            type="submit"
            disabled={!editable || !draft.trim() || sending}
            title="发送（Enter）"
            aria-label="发送"
          >
            ↑
          </button>
        </div>
      </form>
    </section>
  );
}
