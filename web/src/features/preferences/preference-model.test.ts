import { describe, expect, it } from 'vitest'

import { isPreferenceKey, PREFERENCE_KEYS } from '@/features/preferences/preference-model'

describe('preference model', () => {
  it('uses the canonical ui domain for the face type preference', () => {
    const preferenceKeys = new Set<string>(PREFERENCE_KEYS)

    expect(preferenceKeys.has('ui.type')).toBe(true)
    expect(isPreferenceKey('ui.type')).toBe(true)
    expect(preferenceKeys.has('renderer.type')).toBe(false)
    expect(isPreferenceKey('renderer.type')).toBe(false)
  })
})
