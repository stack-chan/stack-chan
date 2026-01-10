import type { StackchanMod } from 'default-mods/mod'
import Timer from 'timer'
import { randomBetween, asyncWait } from 'stackchan-util'
import { Emotion } from 'face-context'
import { DogFace, SimpleFace } from 'behaviors/face'

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
  let manualMouthOpen = false
  let speechVisible = false

  let faceMode: 'simple' | 'dog' = 'simple'
  robot.application.addDrawerButton({
    key: 'setFace',
    label: 'Face',
    kind: 'toggle',
    initialState: false,
    callback: (target) => {
      faceMode = faceMode === 'dog' ? 'simple' : 'dog'
      const nextFace = faceMode === 'dog' ? new DogFace({}) : new SimpleFace({})
      target.renderer?.setFace?.(nextFace)
      robot.application.setDrawerButtonState('setFace', faceMode === 'dog')
      const app = target.renderer?.application as { distribute?: (event: string, payload: unknown) => void } | undefined
      app?.distribute?.('onFaceMode', faceMode)
    },
  })
  robot.application.addDrawerButton({
    key: 'toggleMouth',
    label: 'Mouth',
    kind: 'toggle',
    initialState: manualMouthOpen,
    callback: (target) => {
      manualMouthOpen = !manualMouthOpen
      target.setMouthOpen(manualMouthOpen ? 1 : 0)
      robot.application.setDrawerButtonState('toggleMouth', manualMouthOpen)
    },
  })
  robot.application.addDrawerButton({
    key: 'cycleEmotion',
    label: 'Emotion',
    callback: (target) => {
      emotionIndex = (emotionIndex + 1) % emotions.length
      target.setEmotion(emotions[emotionIndex])
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
   * Button A ... Look around
   */
  let isFollowing = false
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
  if (robot.button?.a != null) {
    robot.button.a.onChanged = async function () {
      if (this.read()) {
        isFollowing = !isFollowing
        robot.driver.setTorque(isFollowing)
        const text = isFollowing ? 'looking' : 'look away'
        robot.showBalloon(text)
        await asyncWait(1000)
        robot.hideBalloon()
      }
    }
  }

  /**
   * Button B ... Test motion
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
  if (robot.button?.b != null) {
    robot.button.b.onChanged = async function () {
      if (this.read() && !isMoving) {
        isFollowing = false
        robot.lookAway()
        isMoving = true
        await testMotion()
        isMoving = false
      }
    }
  }

  /**
   * Button C ... Change color
   */
  let flag = false
  if (robot.button?.c != null) {
    robot.button.c.onChanged = function () {
      if (this.read()) {
        trace('pressed C\n')
        if (flag) {
          robot.setColor('primary', 0xff, 0xff, 0xff)
          robot.setColor('secondary', 0x00, 0x00, 0x00)
        } else {
          robot.setColor('primary', 0x00, 0x00, 0x00)
          robot.setColor('secondary', 0xff, 0xff, 0xff)
        }
        flag = !flag
      }
    }
  }
}
