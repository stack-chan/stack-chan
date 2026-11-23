export type OperatingMode = 'idle' | 'wake-listening' | 'realtime-conversation' | 'media-playback'

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
