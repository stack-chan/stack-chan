import Humidity from 'embedded:sensor/Humidity-Temperature/SHT3x'
import parseBMF from 'commodetto/parseBMF'
import Resource from 'Resource'
import Timer from 'timer'
import { createBalloonDecorator } from 'decorator'

const sensor = new Humidity({ sensor: device.I2C.default })

const font = parseBMF(new Resource('OpenSans-Regular-24.bf4'))
const param = {
  right: 20,
  top: 10,
  width: 200,
  height: font.height,
  font,
}

export function onRobotCreated(robot) {
  const targetLoop = () => {
    const sample = sensor.sample()
    const balloon = createBalloonDecorator({
      ...param,
      text: `Temperature: ${sample.thermometer.temperature.toFixed(2)} C. 
      Humidity: ${sample.hygrometer.humidity.toFixed(2)} %`,
    })

    robot.renderer.addDecorator(balloon)
    Timer.set((id) => robot.renderer.removeDecorator(balloon), 10 * 1000)
  }
  Timer.set(targetLoop, 3 * 1000, 60 * 1000)
}
