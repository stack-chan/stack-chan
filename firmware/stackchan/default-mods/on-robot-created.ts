import { DogFace, ImageFace, SimpleFace } from 'behaviors/face'
import { createCameraPreviewFace } from 'camera-preview'
import type { StackchanMod } from 'default-mods/mod'
import { Emoticon, type EmoticonKey } from 'effects/emoticon'
import { Emotion } from 'face-context'
import type { Content as PiuContent } from 'piu/MC'
import { asyncWait, randomBetween } from 'stackchan-util'
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

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export const onRobotCreated: StackchanMod['onRobotCreated'] = (robot) => {
  const emotions = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]
  let emotionIndex = 0
  let speechVisible = false
  let emoticonEffect: PiuContent | null = null

  let faceMode: 'simple' | 'dog' | 'image' = 'simple'
  let cameraPreviewTimer: ReturnType<typeof Timer.set> | undefined
  const syncFaceMode = (
    app = robot.renderer?.application as { distribute?: (event: string, payload: unknown) => void } | undefined,
  ) => {
    robot.application.setDrawerButtonState('toggleFace', faceMode !== 'simple')
    app?.distribute?.('onFaceMode', faceMode)
  }
  const closeDrawer = () =>
    (robot.renderer?.application as { distribute?: (event: string) => void } | undefined)?.distribute?.('onDrawerClose')
  const createCurrentFace = () =>
    faceMode === 'dog' ? new DogFace({}) : faceMode === 'image' ? new ImageFace({}) : new SimpleFace({})
  const restoreCameraPreview = () => {
    if (cameraPreviewTimer) {
      Timer.clear(cameraPreviewTimer)
      cameraPreviewTimer = undefined
    }
    robot.renderer?.setFace?.(createCurrentFace())
    robot.hideBalloon()
  }
  robot.application.addDrawerButton({
    key: 'toggleFace',
    label: 'Face',
    kind: 'toggle',
    initialState: false,
    callback: (target) => {
      faceMode = faceMode === 'simple' ? 'dog' : faceMode === 'dog' ? 'image' : 'simple'
      target.renderer?.setFace?.(createCurrentFace())
      const app = target.renderer?.application as { distribute?: (event: string, payload: unknown) => void } | undefined
      syncFaceMode(app)
    },
  })
  syncFaceMode()
  robot.application.addDrawerButton({
    key: 'cycleEmotion',
    label: 'Emotion',
    callback: (target) => {
      emotionIndex = (emotionIndex + 1) % emotions.length
      const nextEmotion = emotions[emotionIndex]
      target.setEmotion(nextEmotion)
      if (emoticonEffect) {
        target.renderer?.removeDecorator(emoticonEffect)
        emoticonEffect = null
      }
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
      const key = emotionKeyMap[nextEmotion]
      if (key) {
        emoticonEffect = new Emoticon({ key, name: 'emotion' })
        target.renderer?.addDecorator(emoticonEffect)
      }
    },
  })
  robot.application.addDrawerButton({
    key: 'toggleSpeech',
    label: 'Speech',
    kind: 'toggle',
    initialState: speechVisible,
    callback: (target) => {
      speechVisible = !speechVisible
      if (speechVisible) {
        target.showBalloon('Hello from Stack-chan')
      } else {
        target.hideBalloon()
      }
      robot.application.setDrawerButtonState('toggleSpeech', speechVisible)
    },
  })

  const runCameraPreview = async (target: typeof robot) => {
    try {
      target.showBalloon('starting camera...')
      await target.camera.start({ width: 200, height: 120, imageType: 'rgb565le', useBrowserCamera: true })
      const frame = await target.camera.capture({ width: 200, height: 120, imageType: 'rgb565le' })
      if (!frame) {
        trace('[CameraPreview] capture returned no frame\n')
        target.showBalloon('camera unavailable')
        return
      }
      target.renderer?.setFace?.(
        createCameraPreviewFace(frame, {
          onRender: (mode) => {
            trace(`[CameraPreview] render mode=${mode}\n`)
          },
          onDismiss: restoreCameraPreview,
        }),
      )
      trace(`[CameraPreview] rendered ${frame.width}x${frame.height} ${frame.imageType} via Piu Port\n`)
      closeDrawer()
      target.showBalloon('camera preview')
      if (cameraPreviewTimer) Timer.clear(cameraPreviewTimer)
      cameraPreviewTimer = Timer.set(restoreCameraPreview, CAMERA_PREVIEW_DURATION_MS)
    } catch (error) {
      trace(`[CameraPreview] error ${errorMessage(error)}\n`)
      target.showBalloon('camera error')
    } finally {
      hideBalloonLater(1200)
    }
  }
  robot.application.addDrawerButton({
    key: 'cameraPreview',
    label: 'Camera',
    callback: (target) => {
      void runCameraPreview(target)
    },
  })

  /**
   * Look around (Drawer toggle)
   */
  let isFollowing = false
  const toggleLookAround = async () => {
    isFollowing = !isFollowing
    robot.driver.setTorque(isFollowing)
    robot.application.setDrawerButtonState('toggleLookAround', isFollowing)
    const text = isFollowing ? 'looking' : 'look away'
    robot.showBalloon(text)
    await asyncWait(1000)
    robot.hideBalloon()
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
  robot.application.addDrawerButton({
    key: 'toggleLookAround',
    label: 'Look',
    kind: 'toggle',
    initialState: isFollowing,
    callback: toggleLookAround,
  })

  /**
   * Servo test (Drawer action)
   */
  const testMotion = (onComplete: () => void) => {
    robot.showBalloon('moving...')
    void robot.driver.setTorque(true)

    const rotations = [LEFT, RIGHT, DOWN, UP, FORWARD]
    let index = 0
    const step = () => {
      const rot = rotations[index]
      if (!rot) {
        void robot.driver.setTorque(false)
        robot.hideBalloon()
        onComplete()
        return
      }
      void robot.driver.applyRotation(rot)
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
    robot.application.setDrawerButtonState('toggleLookAround', false)
    isMoving = true
    testMotion(() => {
      isMoving = false
    })
  }
  robot.application.addDrawerButton({
    key: 'servoTest',
    label: 'Servo',
    callback: runServoTest,
  })

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
  robot.application.addDrawerButton({
    key: 'playTone',
    label: 'playTone',
    callback: runPlayTone,
  })
  robot.application.addDrawerButton({
    key: 'recordPlayback',
    label: 'Record and playback',
    callback: runRecordPlayback,
  })

  /**
   * Change color (Drawer action)
   */
  let flag = false
  const toggleColor = () => {
    if (flag) {
      robot.setColor('primary', 0xff, 0xff, 0xff)
      robot.setColor('secondary', 0x00, 0x00, 0x00)
    } else {
      robot.setColor('primary', 0x00, 0x00, 0x00)
      robot.setColor('secondary', 0xff, 0xff, 0xff)
    }
    flag = !flag
  }
  robot.application.addDrawerButton({
    key: 'toggleColor',
    label: 'Color',
    callback: toggleColor,
  })

  if (robot.button != null) {
    robot.button.a.onChanged = function () {
      if (!this.read()) {
        return
      }
      void toggleLookAround()
    }
    robot.button.b.onChanged = function () {
      if (!this.read()) {
        return
      }
      void runServoTest()
    }
    robot.button.c.onChanged = function () {
      if (!this.read()) {
        return
      }
      toggleColor()
    }
  }
}
