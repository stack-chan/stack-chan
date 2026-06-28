import { equal } from 'mocks/assert'
import { onRobotCreated } from 'default-mods/on-robot-created'

trace('=== default-mod face init test ===\n')

const buttons: { key?: string }[] = []
const drawerStates: [string, boolean][] = []
const events: [string, unknown][] = []

const robot = {
  application: {
    addDrawerButton: (button: { key?: string }) => {
      buttons.push(button)
    },
    setDrawerButtonState: (key: string, active: boolean) => {
      drawerStates.push([key, active])
    },
  },
  renderer: {
    application: {
      distribute: (event: string, payload: unknown) => {
        events.push([event, payload])
      },
    },
  },
  driver: {
    setTorque: () => {},
    applyRotation: () => {},
  },
  led: {},
  button: {
    a: null,
    b: null,
    c: null,
  },
  lookAway: () => {},
  lookAt: () => {},
  showBalloon: () => {},
  hideBalloon: () => {},
  setEmotion: () => {},
}

if (!onRobotCreated) {
  throw new Error('onRobotCreated is not defined')
}
try {
  onRobotCreated(robot as never)
} catch (error) {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : error
  trace(`onRobotCreated error: ${message}\n`)
  throw error
}

equal(buttons[0]?.key, 'toggleFace', 'toggleFace button should be registered')
equal(drawerStates[0]?.[0], 'toggleFace', 'toggleFace state should be initialized')
equal(drawerStates[0]?.[1], false, 'toggleFace should start inactive')
equal(events[0]?.[0], 'onFaceMode', 'initial face mode should be distributed')
equal(events[0]?.[1], 'simple', 'initial face mode should be simple')

trace('ok\n')
