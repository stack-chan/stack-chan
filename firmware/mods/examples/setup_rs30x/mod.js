function onContextCreated(robot) {
  let isRight = false
  robot.button.a.onEvent = (event) => {
    if (!event.pressed) {
      return
    }
    trace('flashing id 0x02\n')
    robot._driver._pan.flashId(0x02)
  }
  robot.button.a.onEvent = (event) => {
    if (!event.pressed) {
      return
    }
    const angle = isRight ? 10 : -10
    trace(`changing angle to ${angle}\n`)
    robot._driver._pan.setAngleInTime(angle, 0.3)
    isRight = !isRight
  }
}

export default {
  onContextCreated,
}
