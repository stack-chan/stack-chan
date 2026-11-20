import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, normalizeTheme, readTheme, resolveTheme, THEME_STORAGE_KEY } from '@/lib/theme/theme'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('normalizes and restores only supported values', () => {
    expect(normalizeTheme('dark')).toBe('dark')
    expect(normalizeTheme('sepia')).toBeNull()
    expect(readTheme()).toBe('system')
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    expect(readTheme()).toBe('light')
  })

  it('resolves system preference and applies semantic root state', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList)
    expect(resolveTheme('system')).toBe('dark')
    expect(applyTheme('system')).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})
