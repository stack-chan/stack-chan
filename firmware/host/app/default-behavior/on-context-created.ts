import type { StackchanAppBehavior, StackchanAppBehaviorOption } from 'app-behavior'
import {
  type CameraPreviewFeatureError,
  type CameraPreviewImageType,
  createCameraPreviewFeature,
} from 'app-default-behavior/features/camera-preview-feature'
import { createEmotionControlFeature, type EmotionControlError } from 'app-default-behavior/features/emotion-control'
import { createHandGestureFeature, type HandGestureError } from 'app-default-behavior/features/hand-gesture'
import { DogFace, ImageFace, SimpleFace } from 'behaviors/face'
import type { CameraFrame } from 'camera'
import { type CameraPreviewFrame, createCameraPreviewDialog, prepareCameraPreviewFrame } from 'camera-preview'
import type { StackchanContext } from 'capabilities'
import { Emoticon } from 'effects/emoticon'
import { createJitomeFace, isJitomeFaceSupported } from 'jitome-face'
import { localize } from 'localization'
import config from 'mc/config'
import { composeFeatures, defineMod, type ModFeature } from 'mod-kit'
import { DealWithItFace } from 'parts/image/deal-with-it-face'
import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import { ok } from 'stackchan-result'
import { randomBetween, wait } from 'stackchan-util'
import Timer from 'timer'

const FORWARD = {
  y: 0,
  p: 0,
  r: 0,
}
const LEFT = {
  ...FORWARD,
  y: Math.PI / 6,
}
const RIGHT = {
  ...FORWARD,
  y: -Math.PI / 6,
}
const DOWN = {
  ...FORWARD,
  p: Math.PI / 32,
}
const UP = {
  ...FORWARD,
  p: -Math.PI / 6,
}
const RECORD_PLAYBACK_DURATION_MS = 2000
const CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE: CameraPreviewImageType =
  (config as { format?: string }).format === 'RGB565BE' ? 'rgb565be' : 'rgb565le'
const SPEECH_SYNTHESIS_TEXT = 'こんにちわ。すたっくちゃんです。'

type FaceMode = 'simple' | 'dog' | 'image' | 'jitome' | 'deal-with-it'

type DefaultBehaviorFeatureError =
  | EmotionControlError
  | HandGestureError
  | CameraPreviewFeatureError
  | { readonly feature: string; readonly reason: string }

type DefaultBehaviorDeps = Readonly<{
  robot: StackchanContext
  options: StackchanAppBehaviorOption
  hideBalloonLater: (delay?: number) => void
}>

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

const faceModeFeature: ModFeature<DefaultBehaviorDeps, DefaultBehaviorFeatureError> = ({ robot, options }) => {
  const faceModes: FaceMode[] = isJitomeFaceSupported()
    ? ['simple', 'dog', 'image', 'jitome', 'deal-with-it']
    : ['simple', 'dog', 'image', 'deal-with-it']
  const configuredFace = options.config.ui.type
  let faceMode: FaceMode = faceModes.includes(configuredFace as FaceMode) ? (configuredFace as FaceMode) : 'simple'

  const syncFaceMode = (
    app = robot.ui.application as { distribute?: (event: string, payload: unknown) => void } | undefined,
  ) => {
    app?.distribute?.('onFaceMode', faceMode)
  }
  const createCurrentFace = () => {
    if (faceMode === 'deal-with-it') return new DealWithItFace({})
    if (faceMode === 'dog') return new DogFace({})
    if (faceMode === 'image') return new ImageFace({})
    if (faceMode === 'jitome') return createJitomeFace().content
    return new SimpleFace({})
  }

  robot.drawer.addDrawerButton({
    key: 'toggleFace',
    label: localize('drawer.face'),
    kind: 'choice',
    value: faceMode,
    options: faceModes.map((value) => ({ value, label: localize(`drawer.face.${value}`) })),
    callback: (target, value) => {
      if (!faceModes.includes(value as FaceMode)) return
      faceMode = value as FaceMode
      target.ui.setFace(createCurrentFace())
      const app = target.ui.application as { distribute?: (event: string, payload: unknown) => void } | undefined
      syncFaceMode(app)
    },
  })
  syncFaceMode()

  return ok(undefined)
}

const emotionControlFeature = createEmotionControlFeature<DefaultBehaviorDeps, PiuContent>(({ robot }) => ({
  setEmotion: (emotion) => robot.setEmotion(emotion),
  addEffect: (effect) => robot.ui.addEffect(effect),
  removeEffect: (effect) => robot.ui.removeEffect(effect),
  createEmoticon: (key) => new Emoticon({ key, name: 'emotion' }),
  addDrawerButton: (button) => {
    robot.drawer.addDrawerButton({
      key: button.key,
      label: button.label,
      kind: button.kind,
      value: button.value,
      options: button.options,
      callback: (_target, value) => button.callback(value),
    })
  },
  getBodyPose: () => robot.pose.body,
  setPose: (pose, durationSec) => robot.setPose(pose, durationSec),
  setTorque: (torque) => robot.setTorque(torque),
  localize,
  imu: robot.imu,
  touchPanel: robot.touchPanel,
}))

const balloonAndSpeakFeature: ModFeature<DefaultBehaviorDeps, DefaultBehaviorFeatureError> = ({ robot }) => {
  let speechVisible = false
  robot.drawer.addDrawerButton({
    key: 'toggleSpeech',
    label: localize('drawer.balloon'),
    kind: 'toggle',
    initialState: speechVisible,
    callback: (target) => {
      speechVisible = !speechVisible
      if (speechVisible) {
        target.showBalloon('Hello from Stack-chan')
      } else {
        target.hideBalloon()
      }
      robot.drawer.setDrawerButtonState('toggleSpeech', speechVisible)
    },
  })
  robot.drawer.addDrawerButton({
    key: 'speakStackchan',
    label: 'Speak',
    callback: async (target) => {
      robot.ui.closeDrawer()
      try {
        const result = await target.audio.say(SPEECH_SYNTHESIS_TEXT)
        if ('reason' in result) trace(`[SpeechSynthesis] ${result.reason}\n`)
      } catch (error) {
        trace(`[SpeechSynthesis] error ${errorMessage(error)}\n`)
      }
    },
  })

  return ok(undefined)
}

const handGestureFeature = createHandGestureFeature<DefaultBehaviorDeps>(({ robot }) => ({
  setHandAnimation: (animation) => robot.ui.setHandAnimation(animation),
  closeDrawer: () => robot.ui.closeDrawer(),
  addDrawerButton: (button) => {
    robot.drawer.addDrawerButton({
      key: button.key,
      label: button.label,
      kind: button.kind,
      value: button.value,
      options: button.options,
      callback: (_target, value) => button.callback(value),
    })
  },
}))

const cameraPreviewFeature = createCameraPreviewFeature<
  DefaultBehaviorDeps,
  CameraFrame,
  CameraPreviewFrame,
  PiuContainer
>(({ robot, hideBalloonLater }) => ({
  camera: robot.camera,
  captureImageType: CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE,
  prepareFrame: prepareCameraPreviewFrame,
  createDialog: (preview, options) => createCameraPreviewDialog(preview, options),
  setMain: (content, options) => robot.ui.setMain(content, options),
  closeDrawer: () => robot.ui.closeDrawer(),
  showBalloon: (text) => robot.showBalloon(text),
  hideBalloon: () => robot.hideBalloon(),
  hideBalloonLater,
  localize,
  addDrawerButton: (button) => {
    robot.drawer.addDrawerButton({
      key: button.key,
      label: button.label,
      icon: button.icon,
      callback: () => button.callback(),
    })
  },
}))

const motionAudioAndThemeFeature: ModFeature<DefaultBehaviorDeps, DefaultBehaviorFeatureError> = (
  { robot, hideBalloonLater },
  scope,
) => {
  const poseForRotation = (rotation: typeof robot.pose.body.rotation) => ({
    position: { ...robot.pose.body.position },
    rotation,
  })

  /**
   * Look around (Drawer toggle)
   */
  let isFollowing = false
  const toggleLookAround = async () => {
    const nextFollowing = !isFollowing
    try {
      await robot.setTorque(nextFollowing)
      isFollowing = nextFollowing
      robot.drawer.setDrawerButtonState('toggleLookAround', isFollowing)
      const text = isFollowing ? 'looking' : 'look away'
      robot.showBalloon(text)
      await wait(1000)
      robot.hideBalloon()
    } catch (error) {
      trace(`[Look] toggle error ${errorMessage(error)}\n`)
      robot.drawer.setDrawerButtonState('toggleLookAround', isFollowing)
    }
  }
  const targetLoop = () => {
    if (!isFollowing) {
      robot.lookAway()
      return
    }
    const x = randomBetween(0.4, 1.0)
    const y = randomBetween(-0.4, 0.4)
    const z = randomBetween(-0.02, 0.2)
    trace(`looking at: [${x}, ${y}, ${z}]\n`)
    robot.lookAt([x, y, z])
  }
  const lookAroundTimer = Timer.repeat(targetLoop, 5000)
  scope.own(() => {
    Timer.clear(lookAroundTimer)
  })
  robot.drawer.addDrawerButton({
    key: 'toggleLookAround',
    label: localize('drawer.lookAround'),
    kind: 'toggle',
    initialState: isFollowing,
    callback: toggleLookAround,
  })

  /**
   * Servo test (Drawer action)
   */
  let isMoving = false
  const runServoTest = async () => {
    if (isMoving) return
    isMoving = true
    let failed = false
    const rotations = [LEFT, RIGHT, DOWN, UP, FORWARD]
    try {
      isFollowing = false
      robot.lookAway()
      robot.drawer.setDrawerButtonState('toggleLookAround', false)
      robot.showBalloon('moving...')
      await robot.setTorque(true)
      for (const rotation of rotations) {
        await robot.setPose(poseForRotation(rotation))
        await wait(1000)
      }
    } catch (error) {
      failed = true
      trace(`[ServoTest] motion error ${errorMessage(error)}\n`)
      robot.showBalloon('servo error')
    } finally {
      try {
        await robot.setTorque(false)
      } catch (error) {
        failed = true
        trace(`[ServoTest] torque release error ${errorMessage(error)}\n`)
        robot.showBalloon('servo error')
      }
      isMoving = false
      if (failed) {
        hideBalloonLater(1200)
      } else {
        robot.hideBalloon()
      }
    }
  }
  const startServoTest = () =>
    runServoTest().catch((error) => {
      isMoving = false
      trace(`[ServoTest] unexpected error ${errorMessage(error)}\n`)
    })
  robot.drawer.addDrawerButton({
    key: 'servoTest',
    label: localize('drawer.servo'),
    icon: 'play',
    callback: startServoTest,
  })

  if (Object.keys(robot.led).length) {
    const ledName = Object.keys(robot.led)[0] as string
    let isLighting = false
    const toggleLED = () => {
      isLighting = !isLighting
      if (isLighting) {
        robot.lightRainbow(ledName)
      } else {
        robot.lightOff(ledName)
      }
      robot.drawer.setDrawerButtonState('toggleLED', isLighting)
    }
    robot.drawer.addDrawerButton({
      key: 'toggleLED',
      label: 'LED',
      kind: 'toggle',
      initialState: isLighting,
      callback: toggleLED,
    })
  }

  /**
   * Audio tests (Drawer actions)
   */
  let isAudioTesting = false
  const runPlayTone = async () => {
    if (isAudioTesting) return
    isAudioTesting = true
    robot.showBalloon('playing tone...')
    try {
      trace('[AudioTest] playTone start\n')
      await robot.tone(880, 400, 0.35)
      trace('[AudioTest] playTone complete\n')
      robot.showBalloon('tone complete')
    } catch (error) {
      trace(`[AudioTest] playTone error ${errorMessage(error)}\n`)
      robot.showBalloon('tone error')
    } finally {
      isAudioTesting = false
      hideBalloonLater()
    }
  }
  const runRecordPlayback = async () => {
    if (isAudioTesting) return
    isAudioTesting = true
    robot.showBalloon('recording...')
    try {
      trace(`[AudioTest] record start duration=${RECORD_PLAYBACK_DURATION_MS}\n`)
      const buffer = await robot.record(RECORD_PLAYBACK_DURATION_MS)
      trace(`[AudioTest] record complete bytes=${buffer.byteLength}\n`)
      if (buffer.byteLength === 0) {
        robot.showBalloon('record failed')
        return
      }

      trace('[AudioTest] playback start\n')
      robot.showBalloon('playing...')
      const played = await robot.playAudio(buffer)
      trace(`[AudioTest] playback complete played=${played}\n`)
      robot.showBalloon(played ? 'playback complete' : `recorded ${buffer.byteLength} bytes`)
    } catch (error) {
      trace(`[AudioTest] record playback error ${errorMessage(error)}\n`)
      robot.showBalloon('audio error')
    } finally {
      isAudioTesting = false
      hideBalloonLater(1200)
    }
  }
  robot.drawer.addDrawerButton({
    key: 'playTone',
    label: localize('drawer.playSound'),
    icon: 'play',
    callback: runPlayTone,
  })
  robot.drawer.addDrawerButton({
    key: 'recordPlayback',
    label: localize('drawer.recordAndPlay'),
    icon: 'microphone',
    callback: runRecordPlayback,
  })

  /**
   * Change color (Drawer action)
   */
  let colorMode: 'dark' | 'light' = 'light'
  const colorOptions = [
    { value: 'light', label: localize('drawer.color.light'), color: '#ffffff' },
    { value: 'dark', label: localize('drawer.color.dark'), color: '#000000' },
  ]
  function selectColor(_target: typeof robot, value?: string) {
    if (value === 'dark' || value === 'light') applyColor(value)
  }
  const registerColorDrawerButton = () => {
    robot.drawer.addDrawerButton({
      key: 'toggleColor',
      label: localize('drawer.colorScheme'),
      kind: 'swatch',
      value: colorMode,
      options: colorOptions,
      callback: selectColor,
    })
  }
  const applyColor = (value: 'dark' | 'light') => {
    colorMode = value
    if (colorMode === 'light') {
      robot.setColor('primary', 0xff, 0xff, 0xff)
      robot.setColor('secondary', 0x00, 0x00, 0x00)
    } else {
      robot.setColor('primary', 0x00, 0x00, 0x00)
      robot.setColor('secondary', 0xff, 0xff, 0xff)
    }
    registerColorDrawerButton()
  }
  registerColorDrawerButton()

  if (robot.button != null) {
    const buttonA = robot.button.a
    const buttonB = robot.button.b
    const buttonC = robot.button.c
    const onButtonA = (event: { pressed: boolean }) => {
      if (!event.pressed) return
      void toggleLookAround().catch((error) => trace(`[Button] look error ${errorMessage(error)}\n`))
    }
    const onButtonB = (event: { pressed: boolean }) => {
      if (!event.pressed) return
      void startServoTest()
    }
    const onButtonC = (event: { pressed: boolean }) => {
      if (!event.pressed) return
      applyColor(colorMode === 'light' ? 'dark' : 'light')
    }
    if (buttonA != null) buttonA.onEvent = onButtonA
    if (buttonB != null) buttonB.onEvent = onButtonB
    if (buttonC != null) buttonC.onEvent = onButtonC

    scope.own(() => {
      if (buttonA && buttonA.onEvent === onButtonA) buttonA.onEvent = undefined
      if (buttonB && buttonB.onEvent === onButtonB) buttonB.onEvent = undefined
      if (buttonC && buttonC.onEvent === onButtonC) buttonC.onEvent = undefined
    })
  }

  return ok(undefined)
}

const DEFAULT_BEHAVIOR_FEATURES: readonly ModFeature<DefaultBehaviorDeps, DefaultBehaviorFeatureError>[] = [
  faceModeFeature,
  emotionControlFeature,
  balloonAndSpeakFeature,
  handGestureFeature,
  cameraPreviewFeature,
  motionAudioAndThemeFeature,
]

const defaultContextBehavior = defineMod({
  setup(robot, options, scope) {
    const pendingBalloonTimers = new Set<ReturnType<typeof Timer.set>>()
    let closed = false
    const hideBalloonLater = (delay = 900) => {
      if (closed) return
      const handle = Timer.set(() => {
        pendingBalloonTimers.delete(handle)
        robot.hideBalloon()
      }, delay)
      pendingBalloonTimers.add(handle)
    }
    scope.own(() => {
      closed = true
      for (const handle of pendingBalloonTimers) {
        Timer.clear(handle)
      }
      pendingBalloonTimers.clear()
    })

    return composeFeatures({ robot, options, hideBalloonLater }, scope, DEFAULT_BEHAVIOR_FEATURES, (error) => {
      trace(`[DefaultBehavior] feature ${error.feature} failed: ${error.reason}\n`)
    })
  },
})

export const onContextCreated: NonNullable<StackchanAppBehavior['onContextCreated']> = (robot, options) =>
  defaultContextBehavior.onContextCreated?.(robot, options)

export const onClose: NonNullable<StackchanAppBehavior['onClose']> = () => defaultContextBehavior.onClose?.()
