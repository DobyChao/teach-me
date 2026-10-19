import { useLayoutEffect, useState } from 'react';
import { themes, resolveScheme } from '../shared/appearance.ts';
import type { Appearance, ColorScheme } from '../shared/appearance.ts';

export function applyAppearance(appearance: Appearance, scheme: ColorScheme) {
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;
  root.dataset.colorScheme = scheme;
  root.style.colorScheme = scheme;
  for (const [token, value] of Object.entries(themes[appearance.theme][scheme]))
    root.style.setProperty(`--${token}`, value);
}
export function useAppearancePreview(appearance: Appearance) {
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(
    () => applyAppearance(appearance, resolveScheme(appearance.mode, systemDark)),
    [appearance, systemDark],
  );
}
