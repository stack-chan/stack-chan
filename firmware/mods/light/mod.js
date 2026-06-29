export function onContextCreated(robot) {
  const led = robot.led
  if (!led?.a) {
    throw new Error('This device does not support LED or setup LED named as "a".')
  }

  const colors = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ]
  robot.button.a.onEvent = (event) => {
    if (event.pressed) {
      const firstColor = colors.shift()
      colors.push(firstColor)
      robot.lightOn('a', firstColor.r, firstColor.g, firstColor.b)
    }
  }

  robot.button.b.onEvent = (event) => {
    if (event.pressed) {
      robot.lightOff('a')
    }
  }

  robot.button.c.onEvent = (event) => {
    if (event.pressed) {
      robot.lightRainbow('a')
    }
  }
}
