import Humidity from 'embedded:sensor/Humidity-Temperature/SHT3x'
import Timer from 'timer'

Timer.delay(200)
const sensor = new Humidity({ sensor: device.i2c.default })

const param = {
  right: 20,
  top: 10,
  width: 200,
}

export function onContextCreated(robot) {
  const targetLoop = () => {
    const sample = sensor.sample()
    const temperature = sample?.thermometer?.temperature
    const humidity = sample?.hygrometer?.humidity
    const temperatureText = Number.isFinite(temperature) ? `${temperature.toFixed(2)} C` : '--'
    const humidityText =
      Number.isFinite(humidity) && humidity >= 0 && humidity <= 1 ? `${(humidity * 100).toFixed(2)} %` : '--'
    robot.ui.showBalloon(`Temperature: ${temperatureText}\nHumidity: ${humidityText}`, param)
    Timer.set((_id) => robot.ui.hideBalloon(), 10 * 1000)
  }
  Timer.set(targetLoop, 3 * 1000, 60 * 1000)
}
