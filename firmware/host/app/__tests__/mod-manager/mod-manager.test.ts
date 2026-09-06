import { writeCount } from 'flash'
import { requestModMaintenance, takeModMaintenanceRequest } from 'mod-maintenance'
import startModManager from 'mod-manager'
import type { Container as PiuContainer } from 'piu/MC'
import { Application } from 'piu/MC'
import { state } from 'stackchan-sdcard'
import { equal } from 'testing/assert'
import Timer from 'timer'

const press = (button: PiuContainer) => {
  const behavior = button.behavior as {
    onTouchBegan(button: PiuContainer, id: number, x: number, y: number): void
    onTouchEnded(button: PiuContainer): void
  }
  behavior.onTouchBegan(button, 0, 0, 0)
  behavior.onTouchEnded(button)
}

const application = new Application(null, { touchCount: 1 })
let denied = false
try {
  startModManager(application)
} catch {
  denied = true
}
equal(denied, true, 'SD writing requires a maintenance boot')
requestModMaintenance()
takeModMaintenanceRequest()
let restarts = 0
startModManager(application, () => {
  restarts += 1
})
const list = application.first as PiuContainer
const scroller = list.first?.next as PiuContainer
press((scroller.first as PiuContainer).first as PiuContainer)
press((application.first as PiuContainer).last as PiuContainer)
Timer.set(() => {
  equal(writeCount(), 1, 'confirmed XSA should be written once')
  equal(restarts, 1, 'verified XSA should restart the host')
  state.future = true
  startModManager(application, () => {
    restarts += 1
  })
  const failedList = application.first as PiuContainer
  const failedScroller = failedList.first?.next as PiuContainer
  press((failedScroller.first as PiuContainer).first as PiuContainer)
  press((application.first as PiuContainer).last as PiuContainer)
  Timer.set(() => {
    equal(writeCount(), 0, 'future host API must be rejected before SD flash writing')
    equal(restarts, 1, 'rejected archive must not report installed or restart')
    trace('ok\n')
  }, 10)
}, 10)
