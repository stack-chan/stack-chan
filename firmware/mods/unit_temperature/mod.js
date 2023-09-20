import Humidity from 'embedded:sensor/Humidity-Temperature/SHT3x'
import Timer from 'timer'

Timer.delay(200)
const sensor = new Humidity({ sensor: device.I2C.default })

const param = {
  right: 20,
  top: 10,
  width: 200,
}

export function onRobotCreated(robot) {
  const targetLoop = () => {
    const sample = sensor.sample()
    robot.showBalloon(
      `Temperature: ${sample.thermometer.temperature.toFixed(2)} C. 
      Humidity: ${sample.hygrometer.humidity.toFixed(2)} %`,
      param
    )
    Timer.set((_id) => robot.hideBalloon(), 10 * 1000)
  }
  Timer.set(targetLoop, 3 * 1000, 60 * 1000)
}
