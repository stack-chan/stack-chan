import Performance from 'io-performance'
import { scheduleScreen } from 'screen-scheduler'
import Timer from 'timer'

// Keep display callbacks ahead of XS transport polling. Native capture, codecs,
// playback and networking retain their existing, higher task priorities.
export default function (done) {
  Performance.setMainPriority(6)
  if (globalThis.screen) scheduleScreen(globalThis.screen, Timer)
  done?.()
}
