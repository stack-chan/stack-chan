import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  applyTheme,
  readTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from '@/lib/theme/theme'

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(() => readTheme())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => applyTheme(readTheme()))

  useEffect(() => {
    setResolvedTheme(applyTheme(theme))
    if (theme !== 'system') return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setResolvedTheme(applyTheme('system'))
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  const setTheme = useCallback((nextTheme: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // A blocked storage backend must not prevent changing the live theme.
    }
    updateTheme(nextTheme)
  }, [])

  const value = useMemo(
    () => ({ theme, resolvedTheme: theme === 'system' ? resolvedTheme : resolveTheme(theme), setTheme }),
    [resolvedTheme, setTheme, theme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
