import { useState } from 'react';
import type { Action, Settings, Snapshot } from '../shared/protocol.ts';
export function SettingsView({
  state,
  act,
  onClose,
}: {
  state: Snapshot;
  act: (a: Action) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(state.settings);
  return (
    <section className="settings-view" aria-label="设置">
      <div className="section-title">
        <h2>设置</h2>
        <button onClick={onClose}>返回对话</button>
      </div>
      <label className="setting-row">
        <span>用户消息附带截图</span>
        <input
          type="checkbox"
          checked={draft.attachScreenshot}
          onChange={(e) => setDraft({ ...draft, attachScreenshot: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        <span>在远程控制／屏幕共享中显示应用</span>
        <input
          type="checkbox"
          checked={draft.showInScreenCapture}
          onChange={(e) => setDraft({ ...draft, showInScreenCapture: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        <span>Agent 请求截屏</span>
        <select
          value={draft.captureTier}
          onChange={(e) =>
            setDraft({ ...draft, captureTier: e.target.value as Settings['captureTier'] })
          }
        >
          <option value="ask">每次询问</option>
          <option value="lesson">本次教学默认允许</option>
          <option value="always">始终允许</option>
        </select>
      </label>
      <label className="setting-row">
        <span>自动收起（秒，0 关闭）</span>
        <input
          type="number"
          min="0"
          max="120"
          value={draft.autoCollapseSec}
          onChange={(e) => setDraft({ ...draft, autoCollapseSec: Number(e.target.value) })}
        />
      </label>
      <label className="setting-row">
        <span>继续按钮文案</span>
        <input
          maxLength={80}
          value={draft.continueText}
          onChange={(e) => setDraft({ ...draft, continueText: e.target.value })}
        />
      </label>
      <label className="setting-row">
        <span>教学屏幕</span>
        <select
          value={state.displayId ?? ''}
          onChange={(e) => act({ type: 'select-display', id: Number(e.target.value) })}
        >
          {state.displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} · {d.width}×{d.height} · {Math.round(d.scaleFactor * 100)}%
            </option>
          ))}
        </select>
      </label>
      <p className="muted">输入 Ctrl+Alt+W · 指引显隐 Ctrl+Alt+H</p>
      <label className="setting-row">
        <span>语音识别</span>
        <select
          value={draft.voice.engine}
          onChange={(e) =>
            setDraft({
              ...draft,
              voice: { ...draft.voice, engine: e.target.value as Settings['voice']['engine'] },
            })
          }
        >
          <option value="system">Windows 系统</option>
          <option value="local">本地程序</option>
          <option value="custom">自定义 API</option>
        </select>
      </label>
      {draft.voice.engine === 'local' && (
        <label className="setting-row">
          <span>识别程序路径</span>
          <input
            value={draft.voice.localCommand}
            onChange={(e) =>
              setDraft({ ...draft, voice: { ...draft.voice, localCommand: e.target.value } })
            }
            placeholder="接收音频路径，输出文字"
          />
        </label>
      )}
      {draft.voice.engine === 'custom' && (
        <label className="setting-row">
          <span>语音 API 地址</span>
          <input
            value={draft.voice.customUrl}
            onChange={(e) =>
              setDraft({ ...draft, voice: { ...draft.voice, customUrl: e.target.value } })
            }
            placeholder="HTTP(S) 接口"
          />
        </label>
      )}
      <label className="setting-row">
        <span>朗读 Agent 回复</span>
        <input
          type="checkbox"
          checked={draft.voice.tts}
          onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, tts: e.target.checked } })}
        />
      </label>
      <p className="session-id">会话 {state.session?.id || '尚未开始'}</p>
      <button
        className="primary"
        disabled={!draft.continueText.trim()}
        onClick={() => {
          act({ type: 'settings', settings: draft });
          onClose();
        }}
      >
        保存设置
      </button>
    </section>
  );
}
