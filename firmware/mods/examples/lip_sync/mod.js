import calculatePower from 'calculate-power'

const threshold = 150
export function onContextCreated(robot) {
  const microphone = robot.microphone
  if (!microphone) {
    throw new Error('This device does not support a microphone.')
  }

  microphone.onReadable = function (size) {
    const sampleCount = size / 2
    const samples = new Int16Array(sampleCount)
    this.read(samples.buffer)

    const power = calculatePower(samples.buffer)
    robot.setMouthOpen(Math.min(power / threshold, 1.0))
  }

  microphone.start()
}
