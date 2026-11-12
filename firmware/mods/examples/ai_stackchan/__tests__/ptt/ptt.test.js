import { onClose, onContextCreated } from 'ai-mod'
import { state as defaults } from 'app-default-behavior'
import { Application } from 'piu/MC'
import { state as voice } from 'stackchan/voice'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

const app = new Application(null, { width: 320, height: 240 })
const settle = () => new Promise((resolve) => Timer.set(resolve, 1))
const menus = new Map()
const robot = {
  input: {},
  audio: { microphone: {}, speaker: {}, volume: 0.1 },
  face: { setEmotion() {} },
  ui: {
    addEffect(effect) {
      app.add(effect)
    },
    removeEffect(effect) {
      if (effect.container) app.remove(effect)
    },
    closeDrawer() {},
    showBalloon(message) {
      throw new Error(message)
    },
  },
  drawer: {
    addDrawerButton(item) {
      menus.set(item.key, item)
    },
    removeDrawerButton(key) {
      menus.delete(key)
    },
  },
}
const options = { config: { ai: { token: 'test' } } }
onContextCreated(robot, options)
equal(defaults.calls, 1)
assert(menus.has('settings'))
const touch = app.first
equal(touch.name, 'ai-push-to-talk')
await settle()
assert(touch.y >= 56 && touch.x > 24, 'PTT leaves credit and edge gestures accessible')
assert(touch.y + touch.height <= app.height - 32, 'PTT leaves the bottom gesture edge accessible')
screen.context.onTouchBegan(0, touch.x + 10, touch.y + 10, 0)
await settle()
equal(voice.presses, 1)
touch.behavior.onTouchBegan(touch, 1, touch.x + 10, touch.y + 10, 1)
touch.behavior.onTouchEnded(touch, 1)
equal(voice.releases, 0)
screen.context.onTouchEnded(0, touch.x + 10, touch.y + 10, 1)
equal(voice.releases, 1)
touch.behavior.onTouchBegan(touch, 0, touch.x + 10, touch.y + 10, 2)
await settle()
touch.behavior.onTouchCancelled(touch, 0)
equal(voice.releases, 2)
touch.behavior.onTouchBegan(touch, 0, touch.x + 10, touch.y + 10, 3)
await settle()
await menus.get('ai-end-conversation').callback()
equal(voice.releases, 3)
equal(voice.closes, 1)
touch.behavior.onTouchEnded(touch, 0)
touch.behavior.onTouchBegan(touch, 0, touch.x + 10, touch.y + 10, 4)
await settle()
equal(voice.starts, 2)
equal(voice.presses, 4)
await onClose()
equal(voice.releases, 4)
assert(!touch.container && !touch.active, 'close detaches and disables PTT')
equal(app.length, 0)
equal(voice.closes, 2)
assert(!menus.has('ai-end-conversation'))
await onClose()

const previous = () => {}
robot.input.button = { a: { onEvent: previous } }
onContextCreated(robot, options)
equal(app.length, 0)
robot.input.button.a.onEvent({ pressed: true })
await settle()
equal(voice.presses, 5)
robot.input.button.a.onEvent({ pressed: false })
equal(voice.releases, 5)
await onClose()
equal(robot.input.button.a.onEvent, defaults.handler)
equal(defaults.calls, 2)

robot.input.button = {}
onContextCreated(robot, options)
const pendingTouch = app.first
pendingTouch.behavior.onTouchBegan(pendingTouch, 0, pendingTouch.x + 1, pendingTouch.y + 1, 4)
await onClose()
await settle()
equal(voice.presses, 5, 'closing during startup cannot begin recording')
equal(app.length, 0)
trace('@@STACKCHAN_TEST:PASS@@\n')
