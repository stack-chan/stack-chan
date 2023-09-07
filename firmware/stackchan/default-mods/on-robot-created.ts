import type { StackchanMod } from 'default-mods/mod'
import Timer from 'timer'
import { randomBetween, asyncWait } from 'stackchan-util'

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
  robot.button.a.onChanged = async function () {
    if (this.read()) {
      isFollowing = !isFollowing
      const text = isFollowing ? 'looking' : 'look away'
      robot.showBalloon(text)
      await asyncWait(1000)
      robot.hideBalloon()
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
  robot.button.b.onChanged = async function () {
    if (this.read() && !isMoving) {
      isFollowing = false
      robot.lookAway()
      isMoving = true
      await testMotion()
      isMoving = false
    }
  }

  /**
   * Button C ... Change color
   */
  let flag = false
  robot.button.c.onChanged = function () {
    if (this.read()) {
      trace('pressed B\n')
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
