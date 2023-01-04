import { Robot } from 'robot'
import Timer from 'timer'
import { randomBetween } from 'stackchan-util'

export interface StackchanMod {
  onRobotCreated?: (robot: Robot) => void
}

function onRobotCreated(robot: Robot) {
  let isFollowing: boolean = false
  robot.button.a.onChanged = function() {
    if (this.read()) {
      trace('pressed A')
      isFollowing = !isFollowing
    }
  }
  robot.button.b.onChnaged = function() {
    if (this.read()) {
      trace('pressed B')
    }
  }
  robot.button.b.onChnaged = function() {
    if (this.read()) {
      trace('pressed C')
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

export const defaultMod: StackchanMod = {
  onRobotCreated
}
