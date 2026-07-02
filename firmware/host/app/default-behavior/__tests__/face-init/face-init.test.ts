import { onContextCreated } from 'app-default-behavior/on-context-created'
import { assert, equal } from 'testing/assert'

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
  led: {},
  button: {
    a: null,
    b: null,
    c: null,
  },
  camera: {
    available: false,
  },
  lookAway: () => {},
  lookAt: () => {},
  setPose: () => Promise.resolve(),
  setTorque: () => Promise.resolve(),
  showBalloon: () => {},
  hideBalloon: () => {},
  setEmotion: () => {},
}

if (!onContextCreated) {
  throw new Error('onContextCreated is not defined')
}
try {
  onContextCreated(robot as never, {
    config: {
      wifi: {},
      driver: {},
      ui: {},
      tts: {},
      ai: {},
      led: {},
    },
  })
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
assert(
  buttons.every((button) => button.key !== 'cameraPreview'),
  'cameraPreview button should not be registered when camera is unavailable',
)

trace('ok\n')
