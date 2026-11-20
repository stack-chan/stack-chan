export const THEME_STORAGE_KEY = 'stackchan.theme'
export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]
export type ResolvedTheme = Exclude<Theme, 'system'>

export const normalizeTheme = (value: unknown): Theme | null =>
  typeof value === 'string' && THEMES.includes(value as Theme) ? (value as Theme) : null

export const readTheme = (): Theme => {
  try {
    return normalizeTheme(globalThis.localStorage?.getItem(THEME_STORAGE_KEY)) ?? 'system'
  } catch {
    return 'system'
  }
}

export const systemTheme = (): ResolvedTheme =>
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

export const resolveTheme = (theme: Theme): ResolvedTheme => (theme === 'system' ? systemTheme() : theme)

export const applyTheme = (theme: Theme) => {
  if (typeof document === 'undefined') return resolveTheme(theme)
  const resolved = resolveTheme(theme)
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(resolved)
  document.documentElement.style.colorScheme = resolved
  return resolved
}
