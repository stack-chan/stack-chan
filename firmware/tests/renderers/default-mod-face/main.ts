import { onContextCreated } from 'app-default-behavior/on-context-created'
import { equal } from 'testing/assert'

trace('=== default-mod face init test ===\n')

const buttons: { key?: string }[] = []
const drawerStates: [string, boolean][] = []
const events: [string, unknown][] = []

const robot = {
  drawer: {
    addDrawerButton: (button: { key?: string }) => {
      buttons.push(button)
    },
    setDrawerButtonState: (key: string, active: boolean) => {
      drawerStates.push([key, active])
    },
  },
  ui: {
    application: {
      distribute: (event: string, payload: unknown) => {
        events.push([event, payload])
      },
    },
    addEffect: () => {},
    removeEffect: () => {},
    setFace: () => {},
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

if (!onContextCreated) {
  throw new Error('onContextCreated is not defined')
}
try {
  onContextCreated(robot as never)
} catch (error) {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : error
  trace(`onContextCreated error: ${message}\n`)
  throw error
}

equal(buttons[0]?.key, 'toggleFace', 'toggleFace button should be registered')
equal(drawerStates[0]?.[0], 'toggleFace', 'toggleFace state should be initialized')
equal(drawerStates[0]?.[1], false, 'toggleFace should start inactive')
equal(events[0]?.[0], 'onFaceMode', 'initial face mode should be distributed')
equal(events[0]?.[1], 'simple', 'initial face mode should be simple')

trace('ok\n')
