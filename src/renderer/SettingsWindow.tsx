import { SettingsView } from './SettingsView.tsx';
import { useHost } from './use-host.ts';

export function SettingsWindow() {
  const { state, failure, perform } = useHost();
  if (!state) return <p className="loading">{failure || '正在读取设置…'}</p>;
  return <SettingsView key={String(state.settingsOpen)} state={state} perform={perform} />;
}
