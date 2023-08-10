import Dynamixel, { OPERATING_MODE } from 'dynamixel'
import Timer from 'timer'

export async function onLaunch() {
  const INTERVAL = 50
  const HZ = 1000 / INTERVAL
  // const servo = new Dynamixel({
  //   id: 1,
  // })

  let flag = true
  let toruqeEnable = true
  let id = 1
  let baudrates = [9600, 57600, 115200, 1000000]
  let idx = 0
  let count = 0
  const servo = new Dynamixel({
    id,
  })
  trace('operating mode\n')
  // await servo.setOperatingMode(OPERATING_MODE.CURRENT_BASE_POSITION)
  await servo.setOperatingMode(OPERATING_MODE.CURRENT)

  trace('enable torque\n')
  await servo.setTorque(toruqeEnable)
  // await servo.setGoalCurrent(128)
  let pos = 0
  let current = 0
  Timer.repeat(async () => {
    await servo.setLED(flag)
    count = (count + 1) % (2 * HZ)
    // count += 1
    pos = 2048 + Math.sin(2 * Math.PI * count / HZ) * 512
    current = Math.floor(Math.sin(Math.PI * count / HZ) * 64)
    await servo.setGoalCurrent(current)
    // await servo.setGoalPosition(pos);
    // const value = servo.readPresentCurrent();
    // if (count % 10 === 0) {
    //   toruqeEnable = !toruqeEnable
    //   servo.setTorque(toruqeEnable)
    // }
    // servo.setGoalPosition(999);
    // id = (id + 1) & 0xff
    flag = !flag
  }, INTERVAL)
  // }, 1000)
  return false
}
