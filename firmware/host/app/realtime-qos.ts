export type OperatingMode =
  | 'idle'
  | 'wake-listening'
  | 'realtime-connecting'
  | 'realtime-conversation'
  | 'media-playback'

export type QoSLease = {
  release(): void
}

export type RealtimeQoSAdapter = {
  prepare?(): void
  acquire(mode: OperatingMode): QoSLease | undefined
}

export type RealtimeQoSPort = {
  readonly mode: OperatingMode
  prepare(): void
  enterMode(mode: OperatingMode): QoSLease
}

export type RealtimeConversationPerformance = {
  connected(): void
  close(): void
}

type ActiveLease = {
  readonly mode: OperatingMode
  readonly inner: QoSLease | undefined
}

export function createRealtimeQoS(adapter?: RealtimeQoSAdapter): RealtimeQoSPort {
  const activeLeases: ActiveLease[] = []
  let prepared = false

  return {
    get mode(): OperatingMode {
      return activeLeases.length > 0 ? activeLeases[activeLeases.length - 1].mode : 'idle'
    },
    prepare(): void {
      if (prepared) return
      adapter?.prepare?.()
      prepared = true
    },
    enterMode(mode: OperatingMode): QoSLease {
      const inner = adapter?.acquire(mode)
      const entry: ActiveLease = { mode, inner }
      activeLeases.push(entry)
      let released = false
      return {
        release(): void {
          if (released) return
          released = true
          const index = activeLeases.lastIndexOf(entry)
          if (index >= 0) {
            activeLeases.splice(index, 1)
          }
          entry.inner?.release()
        },
      }
    },
  }
}

export function createRealtimePerformanceScope(qos: RealtimeQoSPort) {
  const cleanups = new Set<() => void>()

  return {
    open(): RealtimeConversationPerformance {
      let lease = qos.enterMode('realtime-connecting')
      let connected = false
      const close = () => {
        if (cleanups.delete(close)) lease.release()
      }
      cleanups.add(close)
      return {
        connected() {
          if (connected || !cleanups.has(close)) return
          const previous = lease
          lease = qos.enterMode('realtime-conversation')
          connected = true
          previous.release()
        },
        close,
      }
    },
    close(): void {
      let firstError: { error: unknown } | undefined
      for (const close of cleanups) {
        try {
          close()
        } catch (error) {
          firstError ??= { error }
        }
      }
      if (firstError) throw firstError.error
    },
  }
}
