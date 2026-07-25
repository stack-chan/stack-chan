import type { StackchanAppBehavior } from 'app-behavior'
import { DEFAULT_BEHAVIOR_DEFINITION } from 'app-default-behavior/interaction-behavior'
import { DogFace, ImageFace, SimpleFace } from 'behaviors/face'
import type { CameraImageType } from 'camera'
import { type CameraPreviewFrame, createCameraPreviewDialog, prepareCameraPreviewFrame } from 'camera-preview'
import { Emotion } from 'face-state'
import { type HandAnimationName, isHandAnimationName } from 'hands'
import type { MotionType } from 'imu'
import { localize } from 'localization'
import config from 'mc/config'
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
const CAMERA_PREVIEW_DURATION_MS = 5000
const CAMERA_PREVIEW_STOP_DELAY_MS = 120
// Capture at the GC0308's native QQVGA size. The preview renderer scales this
// to 200x120; requesting 200 pixels wide selects the larger 240x176 mode and
// increases both the contiguous DMA requirement and frame overflow pressure.
const CAMERA_PREVIEW_CAPTURE_WIDTH = 160
const CAMERA_PREVIEW_CAPTURE_HEIGHT = 120
const CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE: CameraImageType =
  (config as { format?: string }).format === 'RGB565BE' ? 'rgb565be' : 'rgb565le'
const TOUCH_PANEL_PETTING_WINDOW_MS = 1500
const SPEECH_SYNTHESIS_TEXT = 'こんにちわ。すたっくちゃんです。'

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export const onContextCreated: NonNullable<StackchanAppBehavior['onContextCreated']> = (robot) => {
  robot.interaction.install(DEFAULT_BEHAVIOR_DEFINITION)
  const emotions: Emotion[] = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]
  const emotionOptions = [
    { value: String(Emotion.NEUTRAL), label: localize('drawer.emotion.neutral') },
    { value: String(Emotion.HAPPY), label: localize('drawer.emotion.happy') },
    { value: String(Emotion.ANGRY), label: localize('drawer.emotion.angry') },
    { value: String(Emotion.SAD), label: localize('drawer.emotion.sad') },
    { value: String(Emotion.HOT), label: localize('drawer.emotion.hot') },
    { value: String(Emotion.SLEEPY), label: localize('drawer.emotion.sleepy') },
  ]
  let speechVisible = false
  let currentEmotion: Emotion = Emotion.NEUTRAL
  const setSelectedEmotion = (target: typeof robot, nextEmotion: Emotion) => {
    currentEmotion = nextEmotion
    target.setEmotion(nextEmotion)
  }
  const poseForRotation = (rotation: typeof robot.pose.body.rotation) => ({
    position: { ...robot.pose.body.position },
    rotation,
  })

  let faceMode: 'simple' | 'dog' | 'image' = 'simple'
  let handAnimation: HandAnimationName = 'none'
  let cameraPreviewTimer: ReturnType<typeof Timer.set> | undefined
  const syncFaceMode = (
    app = robot.ui.application as { distribute?: (event: string, payload: unknown) => void } | undefined,
  ) => {
    app?.distribute?.('onFaceMode', faceMode)
  }
  const syncHandAnimation = () => robot.ui.setHandAnimation(handAnimation)
  const closeDrawer = () => robot.ui.closeDrawer()
  const createCurrentFace = () =>
    faceMode === 'dog' ? new DogFace({}) : faceMode === 'image' ? new ImageFace({}) : new SimpleFace({})
  const restoreCameraPreview = () => {
    if (cameraPreviewTimer) {
      Timer.clear(cameraPreviewTimer)
      cameraPreviewTimer = undefined
    }
    // Restore the preserved face main component (keeps the current avatar mode/emotion).
    robot.ui.showFace()
    robot.hideBalloon()
  }
  robot.drawer.addDrawerButton({
    key: 'toggleFace',
    label: localize('drawer.face'),
    kind: 'choice',
    value: faceMode,
    options: [
      { value: 'simple', label: localize('drawer.face.simple') },
      { value: 'dog', label: localize('drawer.face.dog') },
      { value: 'image', label: localize('drawer.face.image') },
    ],
    callback: (target, value) => {
      if (value !== 'simple' && value !== 'dog' && value !== 'image') return
      faceMode = value
      target.ui.setFace(createCurrentFace())
      const app = target.ui.application as { distribute?: (event: string, payload: unknown) => void } | undefined
      syncFaceMode(app)
    },
  })
  syncFaceMode()
  robot.drawer.addDrawerButton({
    key: 'cycleEmotion',
    label: localize('drawer.emotion'),
    kind: 'choice',
    value: String(currentEmotion),
    options: emotionOptions,
    callback: (target, value) => {
      const nextEmotion = Number(value) as Emotion
      if (!emotions.includes(nextEmotion) && nextEmotion !== Emotion.NEUTRAL) return
      setSelectedEmotion(target, nextEmotion)
    },
  })
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
      closeDrawer()
      try {
        const result = await target.audio.say(SPEECH_SYNTHESIS_TEXT)
        if ('reason' in result) trace(`[SpeechSynthesis] ${result.reason}\n`)
      } catch (error) {
        trace(`[SpeechSynthesis] error ${errorMessage(error)}\n`)
      }
    },
  })
  robot.drawer.addDrawerButton({
    key: 'handAnimation',
    label: '手',
    kind: 'choice',
    value: handAnimation,
    options: [
      { value: 'none', label: '無し' },
      { value: 'rock-paper-scissors', label: 'グーチョキパー' },
      { value: 'clap', label: '拍手' },
      { value: 'thinking', label: '考え中' },
    ],
    callback: (target, value) => {
      if (!isHandAnimationName(value)) return
      handAnimation = value
      target.ui.setHandAnimation(handAnimation)
      target.ui.closeDrawer()
    },
  })
  syncHandAnimation()

  const runCameraPreview = async (target: typeof robot) => {
    let frame: Awaited<ReturnType<typeof target.camera.capture>> | undefined
    let previewFrame: CameraPreviewFrame | undefined
    const stopCameraAfterPreviewPaint = () =>
      new Promise<void>((resolve) => {
        Timer.set(() => {
          try {
            trace('[CameraPreview] camera stop begin\n')
            const result = target.camera.stop()
            if (result && typeof (result as { then?: unknown }).then === 'function') {
              ;(result as Promise<void>).then(
                () => {
                  trace('[CameraPreview] camera stop done\n')
                  resolve()
                },
                (stopError: unknown) => {
                  trace(`[CameraPreview] stop error ${errorMessage(stopError)}\n`)
                  resolve()
                },
              )
            } else {
              trace('[CameraPreview] camera stop done\n')
              resolve()
            }
          } catch (stopError) {
            trace(`[CameraPreview] stop error ${errorMessage(stopError)}\n`)
            resolve()
          }
        }, CAMERA_PREVIEW_STOP_DELAY_MS)
      })
    try {
      target.showBalloon('starting camera...')
      await target.camera.start({
        width: CAMERA_PREVIEW_CAPTURE_WIDTH,
        height: CAMERA_PREVIEW_CAPTURE_HEIGHT,
        imageType: CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE,
      })
      frame = await target.camera.capture({
        width: CAMERA_PREVIEW_CAPTURE_WIDTH,
        height: CAMERA_PREVIEW_CAPTURE_HEIGHT,
        imageType: CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE,
      })
      if (!frame) {
        trace('[CameraPreview] capture returned no frame\n')
        target.showBalloon('camera unavailable')
        return
      }
      previewFrame = prepareCameraPreviewFrame(frame)
      // Swap the whole main area for a full-area preview dialog; AppBar/Drawer stay active on top.
      // The dialog draws its own caption, so no preview-time balloon is needed.
      target.ui.setMain(
        createCameraPreviewDialog(previewFrame, {
          onRender: (mode) => {
            trace(`[CameraPreview] render mode=${mode}\n`)
          },
          onDismiss: restoreCameraPreview,
        }),
      )
      trace(
        `[CameraPreview] rendered ${previewFrame.width}x${previewFrame.height} ${previewFrame.imageType} via Piu Port\n`,
      )
      closeDrawer()
      if (cameraPreviewTimer) Timer.clear(cameraPreviewTimer)
      cameraPreviewTimer = Timer.set(restoreCameraPreview, CAMERA_PREVIEW_DURATION_MS)
    } catch (error) {
      trace(`[CameraPreview] error ${errorMessage(error)}\n`)
      try {
        target.showBalloon('camera error')
      } catch (balloonError) {
        trace(`[CameraPreview] error balloon failed ${errorMessage(balloonError)}\n`)
      }
    } finally {
      if (frame) {
        trace('[CameraPreview] frame close begin\n')
        frame.close?.()
        trace('[CameraPreview] frame close done\n')
      }
      await stopCameraAfterPreviewPaint()
      hideBalloonLater(1200)
    }
  }
  if (robot.camera.available !== false) {
    robot.drawer.addDrawerButton({
      key: 'cameraPreview',
      label: localize('drawer.camera'),
      icon: 'camera',
      callback: (target) => runCameraPreview(target),
    })
  }

  /**
   * Look around (Drawer toggle)
   */
  let isFollowing = false
  const toggleLookAround = async () => {
    const nextFollowing = !isFollowing
    try {
      await robot.setTorque(nextFollowing)
      isFollowing = nextFollowing
      if (!isFollowing) robot.lookAway()
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
    if (!isFollowing) return
    const x = randomBetween(0.4, 1.0)
    const y = randomBetween(-0.4, 0.4)
    const z = randomBetween(-0.02, 0.2)
    trace(`looking at: [${x}, ${y}, ${z}]\n`)
    robot.lookAt([x, y, z])
  }
  Timer.repeat(targetLoop, 5000)
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
        Timer.set(() => robot.hideBalloon(), 1200)
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

  /**
   * LED test(Drawer action)
   */
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
  const hideBalloonLater = (delay = 900) => {
    Timer.set(() => {
      robot.hideBalloon()
    }, delay)
  }
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

  if (robot.imu != null) {
    const motionReactionMap: Record<MotionType, 'shaken' | 'fallen' | 'upside-down'> = {
      upsideDown: 'upside-down',
      fallenForward: 'fallen',
      fallenBackward: 'fallen',
      fallenLeft: 'fallen',
      fallenRight: 'fallen',
      shake: 'shaken',
    }
    robot.imu.start()
    robot.imu.onEvent = (event) => {
      const type = event.motion
      trace(`[IMU] motion detected: ${type}\n`)
      robot.interaction.dispatch({
        type: 'body-motion',
        motion: motionReactionMap[type],
        strength: 1,
      })
    }
  }

  if (robot.button != null) {
    if (robot.button.a != null) {
      robot.button.a.onEvent = (event) => {
        if (!event.pressed) {
          return
        }
        void toggleLookAround().catch((error) => trace(`[Button] look error ${errorMessage(error)}\n`))
      }
    }
    if (robot.button.b != null) {
      robot.button.b.onEvent = (event) => {
        if (!event.pressed) {
          return
        }
        void startServoTest()
      }
    }
    if (robot.button.c != null) {
      robot.button.c.onEvent = (event) => {
        if (!event.pressed) {
          return
        }
        applyColor(colorMode === 'light' ? 'dark' : 'light')
      }
    }
  }

  if (robot.touchPanel != null) {
    let lastForwardSwipeTicks: number | undefined
    let lastBackwardSwipeTicks: number | undefined
    robot.touchPanel.onEvent = (event) => {
      const type = event.gesture
      trace(`[TouchPanel] gesture: ${type}\n`)
      if (type !== 'forwardSwipe' && type !== 'backwardSwipe') return

      if (type === 'forwardSwipe') lastForwardSwipeTicks = event.ticks
      else lastBackwardSwipeTicks = event.ticks

      const hasRecentForwardSwipe =
        lastForwardSwipeTicks !== undefined && event.ticks - lastForwardSwipeTicks <= TOUCH_PANEL_PETTING_WINDOW_MS
      const hasRecentBackwardSwipe =
        lastBackwardSwipeTicks !== undefined && event.ticks - lastBackwardSwipeTicks <= TOUCH_PANEL_PETTING_WINDOW_MS
      if (hasRecentForwardSwipe && hasRecentBackwardSwipe) {
        trace('[TouchPanel] petting detected: dispatch Interaction event\n')
        robot.interaction.dispatch({
          type: 'petted',
          strength: 1,
        })
        lastForwardSwipeTicks = undefined
        lastBackwardSwipeTicks = undefined
      }
    }
  }
}
