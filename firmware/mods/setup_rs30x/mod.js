function onRobotCreated(robot) {
  let isRight = false
  robot.button.a.onChanged = function () {
    if (!this.read()) {
      return
    }
    trace('flashing id 0x02\n')
    robot._driver._pan.flashId(0x02)
  }
  robot.button.a.onChanged = function () {
    if (!this.read()) {
      return
    }
    const angle = isRight ? 10 : -10
    trace(`changing angle to ${angle}\n`)
    robot._driver._pan.setAngleInTime(angle, 0.3)
    isRight = !isRight
  }
}

export default {
  onRobotCreated,
}
