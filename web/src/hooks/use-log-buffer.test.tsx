import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useLogBuffer } from '@/hooks/use-log-buffer'

describe('useLogBuffer', () => {
  it('retains only the newest entries up to the configured capacity', () => {
    const { result } = renderHook(() => useLogBuffer(2))

    act(() => {
      result.current.append('first')
      result.current.append('second')
      result.current.append('third')
    })

    expect(result.current.entries.map((entry) => entry.message)).toEqual(['second', 'third'])
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps no entries when the capacity is not positive and finite (%s)',
    (capacity) => {
      const { result } = renderHook(() => useLogBuffer(capacity))

      act(() => result.current.append('ignored'))

      expect(result.current.entries).toEqual([])
    }
  )

  it('immediately trims existing entries when the capacity changes', () => {
    const { result, rerender } = renderHook(({ capacity }) => useLogBuffer(capacity), {
      initialProps: { capacity: 3 },
    })
    act(() => {
      result.current.append('first')
      result.current.append('second')
      result.current.append('third')
    })

    rerender({ capacity: 1 })
    expect(result.current.entries.map((entry) => entry.message)).toEqual(['third'])

    rerender({ capacity: 0 })
    expect(result.current.entries).toEqual([])
  })
})
