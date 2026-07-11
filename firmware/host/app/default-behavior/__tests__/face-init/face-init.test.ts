import { onContextCreated } from 'app-default-behavior/on-context-created'
import { Emotion } from 'face-state'
import { assert, equal } from 'testing/assert'

trace('=== default-mod face init test ===\n')

const buttons: { key?: string; kind?: string; value?: string; options?: unknown[] }[] = []
const drawerStates: [string, boolean][] = []
const events: [string, unknown][] = []
const emotions: unknown[] = []
const effects: unknown[] = []
const touchPanel: {
  onEvent?: (event: {
    gesture: 'forwardSwipe' | 'backwardSwipe'
    position: number
    intensity: number
    ticks: number
  }) => void
} = {}

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
    addEffect: (effect: unknown) => {
      effects.push(effect)
    },
    removeEffect: () => {},
    setFace: () => {},
    closeDrawer: () => {},
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
  touchPanel,
  pose: {
    body: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { y: 0, p: 0, r: 0 },
    },
  },
  lookAway: () => {},
  lookAt: () => {},
  setPose: () => Promise.resolve(),
  setTorque: () => Promise.resolve(),
  showBalloon: () => {},
  hideBalloon: () => {},
  setEmotion: (emotion: unknown) => {
    emotions.push(emotion)
  },
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
equal(buttons[0]?.kind, 'choice', 'face selection should use an option menu')
equal(buttons[0]?.value, 'simple', 'face selection should expose its current value')
equal(buttons[0]?.options?.length, 3, 'face selection should expose every mode')
equal(drawerStates.length, 0, 'choice controls should not masquerade as binary toggles')
equal(events[0]?.[0], 'onFaceMode', 'initial face mode should be distributed')
equal(events[0]?.[1], 'simple', 'initial face mode should be simple')
assert(
  buttons.every((button) => button.key !== 'cameraPreview'),
  'cameraPreview button should not be registered when camera is unavailable',
)
assert(touchPanel.onEvent, 'touchPanel handler should be registered')
touchPanel.onEvent?.({ gesture: 'forwardSwipe', position: 0.25, intensity: 3, ticks: 100 })
touchPanel.onEvent?.({ gesture: 'backwardSwipe', position: 0.75, intensity: 3, ticks: 500 })
equal(emotions[emotions.length - 1], Emotion.HAPPY, 'petting swipe pair should set HAPPY emotion')
assert(effects.length > 0, 'petting should add a visible emotion effect')

trace('ok\n')
