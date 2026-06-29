import { randomBetween } from 'stackchan-util'
import Timer from 'timer'

export function onContextCreated(robot) {
  let isFollowing = false
  robot.button.a.onEvent = (event) => {
    if (event.pressed) {
      trace('pressed A\n')
      isFollowing = !isFollowing
    }
  }
  robot.button.b.onEvent = (event) => {
    if (event.pressed) {
      trace('pressed B\n')
    }
  }
  robot.button.c.onEvent = (event) => {
    if (event.pressed) {
      trace('pressed C\n')
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
}
