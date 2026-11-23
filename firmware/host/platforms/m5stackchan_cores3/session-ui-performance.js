import Performance from 'io-performance'
import { trackScreenSchedule } from 'screen-scheduler'
import Timer from 'timer'

let acquireScreen

export default Object.freeze({
  prepare() {
    if (globalThis.screen && !acquireScreen) acquireScreen = trackScreenSchedule(globalThis.screen, Timer)
  },
  acquire() {
    if (!acquireScreen) return
    const releaseScreen = acquireScreen()
    let previousPriority
    try {
      // The main task must stay below native capture at priority 15.
      previousPriority = Performance.setMainPriority(13)
    } catch (error) {
      releaseScreen()
      throw error
    }
    let released = false
    return () => {
      if (released) return
      released = true
      try {
        releaseScreen()
      } finally {
        Performance.setMainPriority(previousPriority)
      }
    }
  },
})
