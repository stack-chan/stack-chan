import Timer from 'timer'

/**
 * @brief calibrates SCServo offset angle
 * @note This mod is under construction. setting pan/tilt offset does not work properly.
 * @param {Robot} robot
 */
async function onRobotCreated(robot) {
  let pan = robot._driver._pan
  let tilt = robot._driver._tilt
  robot.button.a.onChanged = async function () {
    if (!this.read()) {
      return
    }
    trace('setting pan offset\n')
    const { angle: panAngle } = await pan.readStatus()
    await pan.setOffsetAngle(panAngle - 90)
    await pan.saveSettings()
  }
  robot.button.b.onChanged = async function () {
    if (!this.read()) {
      return
    }
    trace('setting tilt offset\n')
    const { angle: tiltAngle } = await tilt.readStatus()
    await tilt.setOffsetAngle(tiltAngle - 90)
    await tilt.saveSettings()
  }
  robot.button.c.onChanged = async function () {
    if (!this.read()) {
      return
    }
    trace('setting zero\n')
    await tilt.setAngle(100)
    await pan.setAngle(100)
    Timer.set(async () => {
      await tilt.setTorque(false)
      await pan.setTorque(false)
    }, 500)
  }

  await pan.setOffsetAngle(0)
  await tilt.setOffsetAngle(0)
  Timer.repeat(async () => {
    const { angle: panAngle } = await pan.readStatus()
    const { angle: tiltAngle } = await tilt.readStatus()
    const panOffset = await pan.readOffsetAngle()
    const tiltOffset = await tilt.readOffsetAngle()
    trace(`(pan, tilt) => (${panAngle}, ${tiltAngle}), (panOffset, tiltOffset) => (${panOffset}, ${tiltOffset})\n`)
  }, 1000)
}

export default {
  onRobotCreated,
}
