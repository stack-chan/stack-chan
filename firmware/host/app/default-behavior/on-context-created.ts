import type { StackchanAppBehavior } from 'app-behavior'
import { DogFace, ImageFace, SimpleFace } from 'behaviors/face'
import type { CameraImageType } from 'camera'
import { type CameraPreviewFrame, createCameraPreviewDialog, prepareCameraPreviewFrame } from 'camera-preview'
import { Emoticon, type EmoticonKey } from 'effects/emoticon'
import { Emotion } from 'face-state'
import type { MotionType } from 'imu'
import config from 'mc/config'
import type { Content as PiuContent } from 'piu/MC'
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
const CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE: CameraImageType =
  (config as { format?: string }).format === 'RGB565BE' ? 'rgb565be' : 'rgb565le'
const TOUCH_PANEL_PETTING_WINDOW_MS = 1500
const TOUCH_PANEL_HAPPY_DURATION_MS = 5000
const TOUCH_PANEL_PET_MOTION_STEP_MS = 220
const TOUCH_PANEL_PET_MOTION_STEP_SEC = TOUCH_PANEL_PET_MOTION_STEP_MS / 1000
const MOTION_DETECT_COLD_DURATION_MS = 5000

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export const onContextCreated: NonNullable<StackchanAppBehavior['onContextCreated']> = (robot) => {
  const emotions: Emotion[] = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]
  const emotionOptions = [
    { value: String(Emotion.NEUTRAL), label: '通常' },
    { value: String(Emotion.HAPPY), label: 'うれしい' },
    { value: String(Emotion.ANGRY), label: '怒り' },
    { value: String(Emotion.SAD), label: '悲しい' },
    { value: String(Emotion.HOT), label: '暑い' },
    { value: String(Emotion.SLEEPY), label: '眠い' },
  ]
  let speechVisible = false
  let emoticonEffect: PiuContent | null = null
  let currentEmotion: Emotion = Emotion.NEUTRAL
  let pettingRestoreTimer: ReturnType<typeof Timer.set> | undefined
  let pettingPreviousEmotion: Emotion | undefined
  let pettingPreviousRotation: typeof robot.pose.body.rotation | undefined
  let pettingMotionActive = false
  let pettingHoldTimer: ReturnType<typeof Timer.set> | undefined
  let motionDetectRestoreTimer: ReturnType<typeof Timer.set> | undefined
  let motionDetectPreviousEmotion: Emotion | undefined
  const emotionKeyMap: Record<Emotion, EmoticonKey | null> = {
    [Emotion.HAPPY]: 'heart',
    [Emotion.ANGRY]: 'angry',
    [Emotion.SAD]: 'tear',
    [Emotion.HOT]: 'sweat',
    [Emotion.SLEEPY]: 'sleepy',
    [Emotion.NEUTRAL]: null,
    [Emotion.DOUBTFUL]: null,
    [Emotion.COLD]: null,
  }
  const setEmotionWithEffect = (target: typeof robot, nextEmotion: Emotion) => {
    currentEmotion = nextEmotion
    target.setEmotion(nextEmotion)
    if (emoticonEffect) {
      target.ui.removeEffect(emoticonEffect)
      emoticonEffect = null
    }
    const key = emotionKeyMap[nextEmotion]
    if (key) {
      emoticonEffect = new Emoticon({ key, name: 'emotion' })
      target.ui.addEffect(emoticonEffect)
    }
  }
  const poseForRotation = (rotation: typeof robot.pose.body.rotation) => ({
    position: { ...robot.pose.body.position },
    rotation,
  })
  const runPettingHoldMotion = async (upRotation: typeof robot.pose.body.rotation) => {
    try {
      await robot.setPose(poseForRotation(upRotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
    } catch (error) {
      trace(`[TouchPanel] pet hold motion error ${errorMessage(error)}\n`)
      try {
        await robot.setTorque(false)
      } catch (torqueError) {
        trace(`[TouchPanel] pet hold torque release error ${errorMessage(torqueError)}\n`)
      }
    }
  }
  const runPettingMotion = async (
    upRotation: typeof robot.pose.body.rotation,
    leftRight: (direction: number) => typeof robot.pose.body.rotation,
    firstDirection: number,
  ) => {
    try {
      await robot.setTorque(true)
      // Multiple visible steps make this read as head shaking, not a single pose change.
      await robot.setPose(poseForRotation(leftRight(firstDirection)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await wait(TOUCH_PANEL_PET_MOTION_STEP_MS)
      await robot.setPose(poseForRotation(leftRight(-firstDirection)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await wait(TOUCH_PANEL_PET_MOTION_STEP_MS)
      await robot.setPose(poseForRotation(leftRight(firstDirection * 0.55)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await wait(TOUCH_PANEL_PET_MOTION_STEP_MS)
      // Keep the happy reaction looking upward until the restore timer returns to the original pose.
      await robot.setPose(poseForRotation(upRotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      pettingHoldTimer = Timer.set(() => {
        pettingHoldTimer = undefined
        void runPettingHoldMotion(upRotation)
      }, TOUCH_PANEL_PET_MOTION_STEP_MS * 2)
    } catch (error) {
      trace(`[TouchPanel] pet motion error ${errorMessage(error)}\n`)
      try {
        await robot.setTorque(false)
      } catch (torqueError) {
        trace(`[TouchPanel] pet motion torque release error ${errorMessage(torqueError)}\n`)
      }
    } finally {
      pettingMotionActive = false
    }
  }
  const runPettingRestoreMotion = async (rotation: typeof robot.pose.body.rotation) => {
    try {
      await robot.setPose(poseForRotation(rotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
    } catch (error) {
      trace(`[TouchPanel] restore motion error ${errorMessage(error)}\n`)
    } finally {
      try {
        await robot.setTorque(false)
      } catch (torqueError) {
        trace(`[TouchPanel] restore torque release error ${errorMessage(torqueError)}\n`)
      }
    }
  }

  let faceMode: 'simple' | 'dog' | 'image' = 'simple'
  let cameraPreviewTimer: ReturnType<typeof Timer.set> | undefined
  const syncFaceMode = (
    app = robot.ui.application as { distribute?: (event: string, payload: unknown) => void } | undefined,
  ) => {
    app?.distribute?.('onFaceMode', faceMode)
  }
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
    label: '顔',
    kind: 'choice',
    value: faceMode,
    options: [
      { value: 'simple', label: 'シンプル' },
      { value: 'dog', label: 'いぬ' },
      { value: 'image', label: '画像' },
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
    label: '表情',
    kind: 'choice',
    value: String(currentEmotion),
    options: emotionOptions,
    callback: (target, value) => {
      const nextEmotion = Number(value) as Emotion
      if (!emotions.includes(nextEmotion) && nextEmotion !== Emotion.NEUTRAL) return
      let canceledPettingMotion = false
      if (pettingRestoreTimer) {
        Timer.clear(pettingRestoreTimer)
        pettingRestoreTimer = undefined
        pettingPreviousEmotion = undefined
        canceledPettingMotion = true
      }
      if (pettingHoldTimer) {
        Timer.clear(pettingHoldTimer)
        pettingHoldTimer = undefined
        canceledPettingMotion = true
      }
      if (canceledPettingMotion) {
        void target
          .setTorque(false)
          .catch((error) => trace(`[TouchPanel] canceled petting torque release error ${errorMessage(error)}\n`))
      }
      setEmotionWithEffect(target, nextEmotion)
    },
  })
  robot.drawer.addDrawerButton({
    key: 'toggleSpeech',
    label: '吹き出し',
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
      await target.camera.start({ width: 200, height: 120, imageType: CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE })
      frame = await target.camera.capture({ width: 200, height: 120, imageType: CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE })
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
      label: 'カメラ',
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
  Timer.repeat(targetLoop, 5000)
  robot.drawer.addDrawerButton({
    key: 'toggleLookAround',
    label: '見回す',
    kind: 'toggle',
    initialState: isFollowing,
    callback: toggleLookAround,
  })

  /**
   * Servo test (Drawer action)
   */
  const testMotion = (onComplete: () => void) => {
    robot.showBalloon('moving...')
    void robot.setTorque(true)

    const rotations = [LEFT, RIGHT, DOWN, UP, FORWARD]
    let index = 0
    const step = () => {
      const rot = rotations[index]
      if (!rot) {
        void robot.setTorque(false)
        robot.hideBalloon()
        onComplete()
        return
      }
      void robot.setPose(poseForRotation(rot))
      index += 1
      Timer.set(step, 1000)
    }
    step()
  }
  let isMoving = false
  const runServoTest = () => {
    if (isMoving) return
    isFollowing = false
    robot.lookAway()
    robot.drawer.setDrawerButtonState('toggleLookAround', false)
    isMoving = true
    testMotion(() => {
      isMoving = false
    })
  }
  robot.drawer.addDrawerButton({
    key: 'servoTest',
    label: 'サーボ',
    icon: 'play',
    callback: runServoTest,
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
    label: '音を再生',
    icon: 'play',
    callback: runPlayTone,
  })
  robot.drawer.addDrawerButton({
    key: 'recordPlayback',
    label: '録音と再生',
    icon: 'microphone',
    callback: runRecordPlayback,
  })

  /**
   * Change color (Drawer action)
   */
  let colorMode: 'dark' | 'light' = 'light'
  const colorOptions = [
    { value: 'light', label: '白', color: '#ffffff' },
    { value: 'dark', label: '黒', color: '#000000' },
  ]
  function selectColor(_target: typeof robot, value?: string) {
    if (value === 'dark' || value === 'light') applyColor(value)
  }
  const registerColorDrawerButton = () => {
    robot.drawer.addDrawerButton({
      key: 'toggleColor',
      label: '配色',
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
    const motionEmotionMap: Record<MotionType, Emotion> = {
      upsideDown: Emotion.SAD,
      fallenForward: Emotion.ANGRY,
      fallenBackward: Emotion.ANGRY,
      fallenLeft: Emotion.ANGRY,
      fallenRight: Emotion.ANGRY,
      shake: Emotion.HOT,
    }
    robot.imu.start()
    robot.imu.onEvent = (event) => {
      const type = event.motion
      trace(`[IMU] motion detected: ${type}\n`)
      if (motionDetectPreviousEmotion === undefined) motionDetectPreviousEmotion = currentEmotion
      if (motionDetectRestoreTimer) Timer.clear(motionDetectRestoreTimer)

      const motionEmotion = motionEmotionMap[type]
      setEmotionWithEffect(robot, motionEmotion)
      motionDetectRestoreTimer = Timer.set(() => {
        if (currentEmotion === motionEmotion) {
          const restoreEmotion = motionDetectPreviousEmotion ?? Emotion.NEUTRAL
          trace(`[IMU] restore emotion ${restoreEmotion}\n`)
          setEmotionWithEffect(robot, restoreEmotion)
        }
        motionDetectPreviousEmotion = undefined
        motionDetectRestoreTimer = undefined
      }, MOTION_DETECT_COLD_DURATION_MS)
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
        void runServoTest()
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
        trace('[TouchPanel] petting detected: set emotion HAPPY with heart effect\n')
        if (pettingPreviousEmotion === undefined) pettingPreviousEmotion = currentEmotion
        if (pettingPreviousRotation === undefined) pettingPreviousRotation = { ...robot.pose.body.rotation }
        if (pettingRestoreTimer) Timer.clear(pettingRestoreTimer)
        if (pettingHoldTimer) {
          Timer.clear(pettingHoldTimer)
          pettingHoldTimer = undefined
        }
        setEmotionWithEffect(robot, Emotion.HAPPY)
        if (!pettingMotionActive) {
          pettingMotionActive = true
          const baseRotation = pettingPreviousRotation
          const yawAmount = randomBetween(Math.PI / 15, Math.PI / 10)
          const pitch = Math.max(-Math.PI / 4, baseRotation.p - randomBetween(Math.PI / 10, Math.PI / 8))
          const firstDirection = Math.random() < 0.5 ? -1 : 1
          const upRotation = { ...baseRotation, p: pitch }
          const leftRight = (direction: number) => ({
            ...baseRotation,
            p: pitch,
            y: Math.max(-Math.PI / 6, Math.min(Math.PI / 6, baseRotation.y + direction * yawAmount)),
          })
          trace(
            `[TouchPanel] pet motion shake yaw=${yawAmount.toFixed(3)} pitch=${pitch.toFixed(3)} direction=${firstDirection}\n`,
          )
          void runPettingMotion(upRotation, leftRight, firstDirection).catch((error) =>
            trace(`[TouchPanel] pet motion rejected ${errorMessage(error)}\n`),
          )
        }
        pettingRestoreTimer = Timer.set(() => {
          const restoreEmotion = pettingPreviousEmotion ?? Emotion.NEUTRAL
          trace(`[TouchPanel] restore emotion ${restoreEmotion}\n`)
          setEmotionWithEffect(robot, restoreEmotion)
          if (pettingHoldTimer) {
            Timer.clear(pettingHoldTimer)
            pettingHoldTimer = undefined
          }
          if (pettingPreviousRotation) {
            void runPettingRestoreMotion(pettingPreviousRotation).catch((error) =>
              trace(`[TouchPanel] restore motion rejected ${errorMessage(error)}\n`),
            )
          }
          pettingPreviousEmotion = undefined
          pettingPreviousRotation = undefined
          pettingRestoreTimer = undefined
        }, TOUCH_PANEL_HAPPY_DURATION_MS)
        lastForwardSwipeTicks = undefined
        lastBackwardSwipeTicks = undefined
      }
    }
  }
}
