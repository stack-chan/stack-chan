export function onRobotCreated(robot) {
  const led = robot.led
  if (!led?.a) {
    throw new Error('This device does not support LED or setup LED named as "a".')
  }

  const colors = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ]
  robot.button.a.onChanged = function () {
    if (this.read()) {
      const firstColor = colors.shift()
      colors.push(firstColor)
      robot.lightOn('a', firstColor.r, firstColor.g, firstColor.b)
    }
  }

  robot.button.b.onChanged = function () {
    if (this.read()) {
      robot.lightOff('a')
    }
  }

  robot.button.c.onChanged = function () {
    if (this.read()) {
      robot.lightRainbow('a')
    }
  }
}
