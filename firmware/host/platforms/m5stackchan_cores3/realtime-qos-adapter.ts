import Modules from 'modules'
import { acquireLowLatency } from 'network-power'
import type { OperatingMode, RealtimeQoSAdapter } from 'realtime-qos'

type UiPerformanceModule = {
  prepare?(): void
  acquire?(): (() => void) | undefined
}

function loadUiPerformance(): UiPerformanceModule | undefined {
  if (!Modules.has('stackchan/realtime-ui-performance')) return undefined
  return Modules.importNow('stackchan/realtime-ui-performance') as UiPerformanceModule
}

let uiLeaseCount = 0
let releaseSharedUi: (() => void) | undefined

function acquireSharedUiPerformance(): () => void {
  if (uiLeaseCount === 0) {
    releaseSharedUi = loadUiPerformance()?.acquire?.()
  }
  uiLeaseCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    uiLeaseCount -= 1
    if (uiLeaseCount === 0) {
      const release = releaseSharedUi
      releaseSharedUi = undefined
      release?.()
    }
  }
}

const adapter: RealtimeQoSAdapter = Object.freeze({
  prepare() {
    loadUiPerformance()?.prepare?.()
  },
  acquire(mode: OperatingMode) {
    if (mode !== 'realtime-conversation') return undefined
    const wifiLease = acquireLowLatency()
    let releaseUi: (() => void) | undefined
    try {
      releaseUi = acquireSharedUiPerformance()
    } catch (error) {
      try {
        wifiLease?.close()
      } catch {}
      throw error
    }
    let released = false
    return {
      release() {
        if (released) return
        released = true
        try {
          releaseUi?.()
        } finally {
          wifiLease?.close()
        }
      },
    }
  },
})

export default adapter
