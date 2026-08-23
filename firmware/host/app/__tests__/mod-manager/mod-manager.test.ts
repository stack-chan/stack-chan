import { writeCount } from 'flash'
import startModManager from 'mod-manager'
import type { Container as PiuContainer } from 'piu/MC'
import { Application } from 'piu/MC'
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
  trace('ok\n')
}, 10)
