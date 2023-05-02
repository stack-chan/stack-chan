import Timer from 'timer'
import { randomBetween } from 'stackchan-util'
import { NetworkService } from 'network-service'

export function onRobotCreated(robot) {
  let isFollowing = true
  const service = new NetworkService({
    ssid: 'myssid',
    password: 'mypasswd'
  })
  service.connect(() => {
    trace('connection complete\n')
  }, () => {
    trace('connection failed\n')
  })
  robot.button.a.onChanged = function () {
    if (this.read()) {
      trace('pressed A\n')
      isFollowing = !isFollowing
    }
  }
  robot.button.b.onChanged = function () {
    if (this.read()) {
      trace('pressed B\n')
    }
  }
  robot.button.c.onChanged = function () {
    if (this.read()) {
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
