import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './Panel.tsx';
import { Overlay } from './Overlay.tsx';
import './styles.css';
const mode = new URLSearchParams(location.search).get('mode');
document.body.className = mode === 'overlay' ? 'overlay-body' : '';
createRoot(document.getElementById('root')!).render(
  <StrictMode>{mode === 'overlay' ? <Overlay /> : <Panel />}</StrictMode>,
);
