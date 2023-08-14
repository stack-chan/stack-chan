import Dynamixel, { OPERATING_MODE } from 'dynamixel'
import { randomBetween } from 'stackchan-util'
import Timer from 'timer'

export async function onLaunch() {
  const INTERVAL = 50
  const HZ = 1000 / INTERVAL
  let flag = true
  let toruqeEnable = true
  let id = 1
  let count = 0
  const servo = new Dynamixel({
    id,
  })
  trace('operating mode\n')
  await servo.setOperatingMode(OPERATING_MODE.CURRENT_BASED_POSITION)

  trace('enable torque\n')
  await servo.setTorque(toruqeEnable)
  let goalPosition = 0
  const P_GAIN = 0.1
  await servo.setGoalPosition(0)
  Timer.repeat(async () => {
    await servo.setLED(flag)
    count = (count + 1) % (2 * HZ)
    if (count === 0) {
      goalPosition = Math.floor(randomBetween(0, 500))
      trace(`goal position changed: ${goalPosition}`)
      await servo.setGoalPosition(goalPosition)
    }
    const result = await servo.readPresentPosition()
    if (!result.success) {
      trace(`failed: ${ result.reason }\n`)
      flag = !flag
      return
    }
    const position = result.value.position
    trace(`pos: ${ position } \n`)
    const current = Math.abs(Math.floor(Math.max(Math.min((goalPosition - position) * P_GAIN, 128), -128)))
    trace(`current: ${current}\n`)
    await servo.setGoalCurrent(current)
    flag = !flag
  }, INTERVAL)
  return false
}
