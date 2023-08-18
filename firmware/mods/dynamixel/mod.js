import Dynamixel, { OPERATING_MODE } from 'dynamixel'
import { randomBetween } from 'stackchan-util'
import Timer from 'timer'

export function onRobotCreated(r) {
  let count = 0
  const driver = r.driver
  r.button.a.onChanged = function () {
    if (this.read()) {
      return
    }
    // const y = count * 0.1 - 1
    // trace(`y: ${y}`)
    const ori = {
      y: count * 0.1 - 1.0,
      p: 0,
      r: 0,
    }
    driver.applyRotation(ori)
    count = (count + 1) % 20
  }
}

export async function onLaunch0() {
  // const servo = new Dynamixel({
  //   id: 1,
  // })
  const servo2 = new Dynamixel({
    id: 2,
  })
  // await servo.setBaudrate(0x03)
  await servo2.setBaudrate(0x03)
  // await servo2.factoryReset(0x03)
  return false
}
export async function onLaunch1() {
  const INTERVAL = 1000
  const HZ = 1000 / INTERVAL
  let flag = true
  let toruqeEnable = true
  let count = 0
  // const servo = new Dynamixel({
  //   id: 1,
  // })
  const servo2 = new Dynamixel({
    id: 2,
  })
  trace('operating mode\n')
  // await servo.setOperatingMode(OPERATING_MODE.POSITION)
  // await servo2.setOperatingMode(OPERATING_MODE.POSITION)
  // await servo.setOperatingMode(OPERATING_MODE.CURRENT_BASED_POSITION)
  await servo2.setOperatingMode(OPERATING_MODE.CURRENT_BASED_POSITION)

  // await servo.setProfileAcceleration(20)
  // await servo.setProfileVelocity(100)
  await servo2.setProfileVelocity(20)
  trace('enable torque\n')
  // await servo.setTorque(toruqeEnable)
  await servo2.setTorque(toruqeEnable)
  let pos = [2048, 2048]
  const P_GAIN = 0.1
  const P_GAIN2 = 0.3
  const offset = 0
  // await servo.setGoalPosition(offset)
  await servo2.setGoalPosition(offset)
  Timer.repeat(async () => {
    // await servo.setLED(flag)
    // await servo2.setLED(!flag)
    flag = !flag

    count = (count + 1) % (3 * HZ)
    if (count === 0) {
      pos[0] = Math.floor(randomBetween(offset - 512, offset + 512))
      pos[1] = Math.floor(randomBetween(offset - 256, offset + 256))
      trace(`goal position changed: (${pos[0]}, ${pos[1]})\n`)
      // await servo.setGoalPosition(pos[0])
      // const result = await servo.readPresentPosition()
      // if (!result.success) {
      //   trace(`failed: ${result.reason}\n`)
      //   return
      // }
      await servo2.setGoalPosition(pos[1])
    }

    /*
    const { value: velocity } = await servo.readPresentVelocity()
    if (velocity != null) {
      trace(`present velocity: ${velocity}\n`)
    }
    */

    /*
    const result = await servo.readPresentPosition()
    if (!result.success) {
      trace(`failed: ${result.reason}\n`)
    } else {
      const position = result.value
      // trace(`pos: ${ position } \n`)
      const current = Math.min(Math.abs(pos[0] - position) * P_GAIN, 80)
      // trace(`current: ${current}\n`)
      await servo.setGoalCurrent(current)
    }
    */

    const result2 = await servo2.readPresentPosition()
    if (!result2.success) {
      trace(`2 failed: ${result2.reason}\n`)
    } else {
      const position2 = result2.value
      // trace(`pos2: ${ position2 } \n`)
      const current2 = Math.min(Math.abs(pos[1] - position2) * P_GAIN2, 100)
      // trace(`current2: ${current2}\n`)
      await servo2.setGoalCurrent(current2)
    }
  }, INTERVAL)
  return false
}
