import Timer from 'timer'

const LED_NAME = 'head'
const STEP_MS = 1200

function delay(ms) {
  return new Promise((resolve) => Timer.set(resolve, ms))
}

async function runSmoke(robot) {
  trace('[M5StackChan CoreS3 smoke] start\n')
  trace('[M5StackChan CoreS3 smoke] target=esp32:./platforms/m5stackchan_cores3 mod=mods/m5stackchan_smoke\n')

  try {
    trace('[M5StackChan CoreS3 smoke] servo: torque on\n')
    await robot.setTorque(true)
    trace('[M5StackChan CoreS3 smoke] servo: neutral pose\n')
    await robot.setPose({ rotation: { y: 0, p: 0, r: 0 } }, 0.5)
    await delay(STEP_MS)
    trace('[M5StackChan CoreS3 smoke] servo: small yaw/pitch check\n')
    await robot.setPose({ rotation: { y: 0.08, p: -0.06, r: 0 } }, 0.5)
    await delay(STEP_MS)
    trace('[M5StackChan CoreS3 smoke] servo: neutral pose\n')
    await robot.setPose({ rotation: { y: 0, p: 0, r: 0 } }, 0.5)
  } catch (error) {
    trace(`[M5StackChan CoreS3 smoke] servo: error ${error}\n`)
  } finally {
    try {
      trace('[M5StackChan CoreS3 smoke] servo: torque off\n')
      await robot.setTorque(false)
    } catch (error) {
      trace(`[M5StackChan CoreS3 smoke] servo: torque off error ${error}\n`)
    }
  }

  trace('[M5StackChan CoreS3 smoke] LED: lightOn red\n')
  robot.lightOn(LED_NAME, 24, 0, 0)
  await delay(STEP_MS)
  trace('[M5StackChan CoreS3 smoke] LED: lightBlink green\n')
  robot.lightBlink(LED_NAME, 0, 24, 0, 250)
  await delay(STEP_MS * 2)
  trace('[M5StackChan CoreS3 smoke] LED: lightRainbow\n')
  robot.lightRainbow(LED_NAME)
  await delay(STEP_MS * 2)
  trace('[M5StackChan CoreS3 smoke] LED: lightOff\n')
  robot.lightOff(LED_NAME)

  trace('[M5StackChan CoreS3 smoke] complete\n')
}

export function onRobotCreated(robot) {
  Timer.set(() => {
    void runSmoke(robot)
  }, 1000)
}
