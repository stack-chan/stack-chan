import { onContextCreated } from 'app-default-behavior/on-context-created'
import { Emotion } from 'face-state'
import { assert, equal } from 'testing/assert'

trace('=== default-mod face init test ===\n')

type RegisteredButton = {
  key?: string
  kind?: string
  value?: string
  options?: unknown[]
  callback?: (target: unknown, value?: string) => Promise<void> | void
}

const buttons: RegisteredButton[] = []
const drawerStates: [string, boolean][] = []
const events: [string, unknown][] = []
const emotions: unknown[] = []
const effects: unknown[] = []
const faces: unknown[] = []
const colors: [string, number, number, number][] = []
const speechRequests: string[] = []
let drawerCloseCount = 0
const touchPanel: {
  onEvent?: (event: {
    gesture: 'forwardSwipe' | 'backwardSwipe'
    position: number
    intensity: number
    ticks: number
  }) => void
} = {}

const robot = {
  audio: {
    say: (text: string) => {
      speechRequests.push(text)
      return Promise.resolve({})
    },
  },
  drawer: {
    addDrawerButton: (button: RegisteredButton) => {
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
    setFace: (face: unknown) => {
      faces.push(face)
    },
    closeDrawer: () => {
      drawerCloseCount += 1
    },
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
  setColor: (key: string, r: number, g: number, b: number) => {
    colors.push([key, r, g, b])
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
buttons.find((button) => button.key === 'toggleFace')?.callback?.(robot, 'dog')
equal(faces.length, 1, 'face choice should replace the rendered face')
equal(events[events.length - 1]?.[1], 'dog', 'face choice should distribute the selected face mode')
buttons.find((button) => button.key === 'cycleEmotion')?.callback?.(robot, String(Emotion.ANGRY))
equal(emotions[emotions.length - 1], Emotion.ANGRY, 'emotion choice should update the face context')
buttons.find((button) => button.key === 'toggleColor')?.callback?.(robot, 'dark')
equal(colors[colors.length - 2]?.[0], 'primary', 'color choice should update the primary face color')
equal(colors[colors.length - 2]?.[1], 0x00, 'dark color choice should make the primary face color black')
equal(colors[colors.length - 1]?.[0], 'secondary', 'color choice should update the secondary face color')
equal(colors[colors.length - 1]?.[1], 0xff, 'dark color choice should make the secondary face color white')
assert(
  buttons.every((button) => button.key !== 'cameraPreview'),
  'cameraPreview button should not be registered when camera is unavailable',
)
const speakButton = buttons.find((button) => button.key === 'speakStackchan')
assert(speakButton, 'speakStackchan button should be registered')
assert(touchPanel.onEvent, 'touchPanel handler should be registered')
touchPanel.onEvent?.({ gesture: 'forwardSwipe', position: 0.25, intensity: 3, ticks: 100 })
touchPanel.onEvent?.({ gesture: 'backwardSwipe', position: 0.75, intensity: 3, ticks: 500 })
equal(emotions[emotions.length - 1], Emotion.HAPPY, 'petting swipe pair should set HAPPY emotion')
assert(effects.length > 0, 'petting should add a visible emotion effect')

Promise.resolve(speakButton?.callback?.(robot)).then(
  () => {
    equal(speechRequests.length, 1, 'speakStackchan should request one utterance')
    equal(speechRequests[0], 'こんにちわ。すたっくちゃんです。', 'speakStackchan should request its greeting')
    equal(drawerCloseCount, 1, 'speakStackchan should close the drawer before speaking')
    trace('ok\n')
  },
  (error) => {
    trace(`speakStackchan callback error: ${String(error)}\n`)
    throw error
  },
)
