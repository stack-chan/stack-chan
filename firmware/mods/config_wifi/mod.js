import Timer from 'timer'
import { randomBetween } from 'stackchan-util'
import { NetworkService } from 'network-service'
import { PreferenceServer } from 'preference-server'
import { NoneDriver } from 'none-driver'
import Preference from 'preference'

const DOMAIN = 'robot'

export function onRobotCreated(robot) {
  robot.useDriver(new NoneDriver())
  let isFollowing = true
  const server = new PreferenceServer({
    onPreferenceChanged: (key, value) => {
      trace(`preference changed! ${key}: ${value}\n`)
    },
  })
  const ssid = Preference.get(DOMAIN, 'ssid')
  const password = Preference.get(DOMAIN, 'password')
  if (ssid?.length > 0 && password?.length > 0) {
    const service = new NetworkService({
      ssid: ssid,
      password: password,
    })
    service.connect(
      () => {
        trace('connection complete\n')
      },
      () => {
        trace('connection failed\n')
      }
    )
  }
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
