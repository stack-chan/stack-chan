import { useCallback, useEffect, useRef, useState } from 'react'

import { type LogEntry, type LogLevel, type LogSource } from '@/components/stackchan/log-console'

export function useLogBuffer(maxEntries = 400) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const sequence = useRef(0)
  const capacity = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 0
  const visibleEntries = capacity === 0 ? [] : entries.length > capacity ? entries.slice(-capacity) : entries

  useEffect(() => {
    setEntries((current) => {
      if (capacity === 0) return current.length === 0 ? current : []
      return current.length > capacity ? current.slice(-capacity) : current
    })
  }, [capacity])

  const append = useCallback(
    (message: string, level: LogLevel = 'info', source?: LogSource) => {
      if (capacity === 0) {
        return
      }
      const entry: LogEntry = {
        id: `${Date.now()}-${sequence.current++}`,
        timestamp: Date.now(),
        level,
        source,
        message,
      }
      setEntries((current) => [...current, entry].slice(-capacity))
    },
    [capacity]
  )

  const clear = useCallback(() => setEntries([]), [])
  return { entries: visibleEntries, append, clear }
}
