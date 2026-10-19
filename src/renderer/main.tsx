import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './Panel.tsx';
import { Overlay } from './Overlay.tsx';
import { SettingsWindow } from './SettingsWindow.tsx';
import './styles.css';
const mode = new URLSearchParams(location.search).get('mode');
if (mode === 'settings') document.title = 'Teach me, Agent · 设置';
document.body.className =
  mode === 'overlay' ? 'overlay-body' : mode === 'settings' ? 'settings-body' : '';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {mode === 'overlay' ? <Overlay /> : mode === 'settings' ? <SettingsWindow /> : <Panel />}
  </StrictMode>,
);
