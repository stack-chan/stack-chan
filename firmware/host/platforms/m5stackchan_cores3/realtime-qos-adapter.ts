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

let wifiLeaseCount = 0
let sharedWifiLease: { close(): void } | undefined

function acquireSharedLowLatency(): () => void {
  if (wifiLeaseCount === 0) {
    sharedWifiLease = acquireLowLatency()
  }
  wifiLeaseCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    wifiLeaseCount -= 1
    if (wifiLeaseCount === 0) {
      const lease = sharedWifiLease
      sharedWifiLease = undefined
      lease?.close()
    }
  }
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
    if (mode !== 'realtime-connecting' && mode !== 'realtime-conversation') return undefined
    const releaseWifi = acquireSharedLowLatency()
    let releaseUi: (() => void) | undefined
    if (mode === 'realtime-conversation') {
      try {
        releaseUi = acquireSharedUiPerformance()
      } catch (error) {
        try {
          releaseWifi()
        } catch {}
        throw error
      }
    }
    let released = false
    return {
      release() {
        if (released) return
        released = true
        try {
          releaseUi?.()
        } finally {
          releaseWifi()
        }
      },
    }
  },
})

export default adapter
