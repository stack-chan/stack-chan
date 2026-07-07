function onContextCreated(robot) {
  const pan = robot.motion.calibration?.pan
  const buttonA = robot.input.button?.a

  if (pan == null || buttonA == null) {
    trace('setup_rs30x requires pan calibration support and button A\n')
    return
  }

  if (pan.flashId == null) {
    trace('setup_rs30x requires flashId calibration support\n')
    return
  }

  let didFlashId = false
  let isRight = false

  function setNextAngle() {
    const angle = isRight ? 10 : -10
    trace(`changing angle to ${angle}\n`)
    pan.setAngle(angle, 0.3, (error) => {
      if (error != null) {
        trace(`setup_rs30x angle failed: ${error}\n`)
        return
      }
      isRight = !isRight
    })
  }

  buttonA.onEvent = (event) => {
    if (!event.pressed) {
      return
    }

    if (!didFlashId) {
      trace('flashing id 0x02\n')
      pan.flashId(0x02, (error) => {
        if (error != null) {
          trace(`setup_rs30x flashId failed: ${error}\n`)
          return
        }
        didFlashId = true
        setNextAngle()
      })
      return
    }

    setNextAngle()
  }
}

export default {
  onContextCreated,
}
