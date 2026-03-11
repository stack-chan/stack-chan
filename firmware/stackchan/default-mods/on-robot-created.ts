import type { StackchanMod } from 'default-mods/mod'
import Timer from 'timer'
import { randomBetween, asyncWait } from 'stackchan-util'
import { Emotion } from 'face-context'
import { DogFace, SimpleFace } from 'behaviors/face'
import { Emoticon, type EmoticonKey } from 'effects/emoticon'
import type { Content as PiuContent } from 'piu/MC'

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

export const onRobotCreated: StackchanMod['onRobotCreated'] = (robot) => {
  const emotions = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]
  let emotionIndex = 0
  let speechVisible = false
  let emoticonEffect: PiuContent | null = null

  let faceMode: 'simple' | 'dog' = 'simple'
  robot.application.addDrawerButton({
    key: 'toggleFace',
    label: 'Face',
    kind: 'toggle',
    initialState: false,
    callback: (target) => {
      faceMode = faceMode === 'dog' ? 'simple' : 'dog'
      const nextFace = faceMode === 'dog' ? new DogFace({}) : new SimpleFace({})
      target.renderer?.setFace?.(nextFace)
      robot.application.setDrawerButtonState('toggleFace', faceMode === 'dog')
      const app = target.renderer?.application as { distribute?: (event: string, payload: unknown) => void } | undefined
      app?.distribute?.('onFaceMode', faceMode)
    },
  })
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
  const testMotion = async () => {
    robot.showBalloon('moving...')
    await robot.driver.setTorque(true)

    for (const rot of [LEFT, RIGHT, DOWN, UP, FORWARD]) {
      robot.driver.applyRotation(rot)
      await asyncWait(1000)
    }

    await robot.driver.setTorque(false)
    robot.hideBalloon()
  }
  let isMoving = false
  const runServoTest = async () => {
    if (isMoving) return
    isFollowing = false
    robot.lookAway()
    robot.application.setDrawerButtonState('toggleLookAround', false)
    isMoving = true
    await testMotion()
    isMoving = false
  }
  robot.application.addDrawerButton({
    key: 'servoTest',
    label: 'Servo',
    callback: runServoTest,
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
