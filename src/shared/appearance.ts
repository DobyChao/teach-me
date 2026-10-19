export type ColorScheme = 'light' | 'dark';
export type ColorMode = ColorScheme | 'system';
export const themeIds = ['rose'] as const;
export type ThemeId = (typeof themeIds)[number];
export type Appearance = { mode: ColorMode; theme: ThemeId };
export const defaultAppearance: Appearance = { mode: 'dark', theme: 'rose' };
export const resolveScheme = (mode: ColorMode, systemDark: boolean): ColorScheme =>
  mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

// Data only. New built-in themes implement the same semantic palette, without UI or host logic.
const dark = {
  bg: '#14161b',
  surface: '#1c1f26',
  'surface-2': '#232731',
  line: '#2b2f39',
  text: '#e9ebf0',
  muted: '#9ba2b1',
  accent: '#ff3d7f',
  'on-accent': '#19151d',
  ok: '#34d399',
  busy: '#fbbf24',
  'accent-soft': '#522239',
  'accent-strong': '#dc2f6b',
};
export type Palette = Record<keyof typeof dark, string>;
export const themes: Record<ThemeId, { label: string; light: Palette; dark: Palette }> = {
  rose: {
    label: '冷灰 · 玫粉',
    dark,
    light: {
      bg: '#fafbfe',
      surface: '#f0f2f7',
      'surface-2': '#e6e9f1',
      line: '#d5dae5',
      text: '#202431',
      muted: '#616b7d',
      accent: '#c71e60',
      'on-accent': '#ffffff',
      ok: '#087a59',
      busy: '#915900',
      'accent-soft': '#fce2ec',
      'accent-strong': '#a9174f',
    },
  },
};
