import Dynamixel, { OPERATING_MODE } from 'protocols/dynamixel'
import { randomBetween } from 'stackchan-util'
import Timer from 'timer'

/**
 * Press button A to change rotation
 * @param {*} r - Robot instance
 */
export function onContextCreated(r) {
  let count = 0
  const driver = r.driver
  r.button.a.onEvent = (event) => {
    if (event.pressed) {
      return
    }
    const ori = {
      y: count * 0.1 - 1.0,
      p: 0,
      r: 0,
    }
    driver.applyRotation(ori)
    count = (count + 1) % 20
  }
}

/**
 * Changes baudrate of two servos
 * @see https://emanual.robotis.com/docs/en/dxl/x/xl330-m288/#baud-rate
 */
function runSteps(steps, onDone = () => {}) {
  let index = 0
  const next = (error) => {
    if (error != null) {
      trace(`dynamixel step failed: ${error}\n`)
      onDone(error)
      return
    }
    const step = steps[index]
    index += 1
    if (step == null) {
      onDone()
      return
    }
    step(next)
  }
  next()
}

// export function onLaunch() {
export function changeBaudrate() {
  const servo = new Dynamixel({
    id: 1,
  })
  const servo2 = new Dynamixel({
    id: 2,
  })
  runSteps([(next) => servo.setBaudrate(0x03 /* 1Mbps */, next), (next) => servo2.setBaudrate(0x03, next)])
  return false
}

/**
 * Changes baudrate of two servos
 * @see https://emanual.robotis.com/docs/en/dxl/x/xl330-m288/#baud-rate
 */
export function onLaunch() {
  // export function testServos() {
  const INTERVAL = 1000
  const HZ = 1000 / INTERVAL
  let flag = true
  const toruqeEnable = true
  let count = 0
  let updating = false
  const servo = new Dynamixel({
    id: 1,
  })
  const servo2 = new Dynamixel({
    id: 2,
  })
  trace('operating mode\n')
  const pos = [2048, 2048]
  const P_GAIN = 0.1
  const P_GAIN2 = 0.3
  const offset = 0

  const updateCurrent = (servo, goal, gain, maxCurrent, label, next) => {
    servo.readPresentPosition((result) => {
      if (!result.success) {
        trace(`failed${label}: ${result.reason}\n`)
        next()
        return
      }
      const position = result.value
      trace(`pos${label}: ${position} \n`)
      const current = Math.min(Math.abs(goal - position) * gain, maxCurrent)
      trace(`current${label}: ${current}\n`)
      servo.setGoalCurrent(current, next)
    })
  }

  const updateServos = () => {
    if (updating) {
      return
    }
    updating = true
    runSteps(
      [
        (next) => servo.setLED(flag, next),
        (next) => servo2.setLED(!flag, next),
        (next) => {
          flag = !flag
          count = (count + 1) % (3 * HZ)
          if (count !== 0) {
            next()
            return
          }
          pos[0] = Math.floor(randomBetween(offset - 512, offset + 512))
          pos[1] = Math.floor(randomBetween(offset - 256, offset + 256))
          trace(`goal position changed: (${pos[0]}, ${pos[1]})\n`)
          runSteps(
            [(done) => servo.setGoalPosition(pos[0], done), (done) => servo2.setGoalPosition(pos[1], done)],
            next,
          )
        },
        (next) => {
          servo.readPresentVelocity((result) => {
            if (result.success) {
              trace(`present velocity: ${result.value}\n`)
            }
            next()
          })
        },
        (next) => updateCurrent(servo, pos[0], P_GAIN, 80, 1, next),
        (next) => updateCurrent(servo2, pos[1], P_GAIN2, 100, 2, next),
      ],
      () => {
        updating = false
      },
    )
  }

  runSteps(
    [
      (next) => servo.setOperatingMode(OPERATING_MODE.CURRENT_BASED_POSITION, next),
      (next) => servo2.setOperatingMode(OPERATING_MODE.CURRENT_BASED_POSITION, next),
      (next) => servo.setProfileAcceleration(20, next),
      (next) => servo.setProfileVelocity(100, next),
      (next) => servo2.setProfileVelocity(20, next),
      (next) => {
        trace('enable torque\n')
        servo.setTorque(toruqeEnable, next)
      },
      (next) => servo2.setTorque(toruqeEnable, next),
      (next) => servo.setGoalPosition(offset, next),
      (next) => servo2.setGoalPosition(offset, next),
    ],
    (error) => {
      if (error != null) {
        return
      }
      Timer.repeat(updateServos, INTERVAL)
    },
  )
  return false
}
