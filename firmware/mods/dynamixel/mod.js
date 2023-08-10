import Dynamixel from 'dynamixel'
import Timer from 'timer'
export function onLaunch() {
  // const servo = new Dynamixel({
  //   id: 1,
  // })
  
  let flag = true
  let id = 1
  let baudrates = [
    9600,
    57600,
    115200,
    1000000
  ]
  let idx = 0
  const servo = new Dynamixel({
    id,
  })
  Timer.repeat(() => {
    trace(`sending to ${id}\n`)
    servo.setId(id)
    servo.setLED(flag);
    // servo.setGoalPosition(999);
    if (id === 255) {
      Timer.delay(500)
      idx = (idx + 1) % baudrates.length
      trace(`setting baudrates to ${baudrates[idx]}`)
      Dynamixel.setBaud(baudrates[idx])
    }
    // id = (id + 1) & 0xff
    flag = !flag
  }, 500)
  return false
}
