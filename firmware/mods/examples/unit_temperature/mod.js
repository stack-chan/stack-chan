import SHT3x from 'embedded:sensor/Humidity-Temperature/SHT3x'
import Timer from 'timer'

const sensor = new SHT3x({ sensor: device.I2C.default })

const param = {
  right: 20,
  top: 10,
  width: 200,
}

export function onContextCreated(robot) {
  const targetLoop = () => {
    const sample = sensor.sample()
    if (sample === undefined) {
      robot.ui.showBalloon('Sensor read failed.', param)
      return
    }
    robot.ui.showBalloon(
      `Temperature: ${sample.thermometer.temperature.toFixed(2)} C.
      Humidity: ${(sample.hygrometer.humidity * 100).toFixed(2)} %`,
      param,
    )
    Timer.set((_id) => robot.ui.hideBalloon(), 10 * 1000)
  }
  Timer.set(targetLoop, 3 * 1000, 60 * 1000)
}
