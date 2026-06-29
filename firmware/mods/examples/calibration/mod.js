import Timer from 'timer'

/**
 * @brief calibrates SCServo offset angle
 * @note This mod is under construction. setting pan/tilt offset does not work properly.
 * @param {Robot} robot
 */
function traceError(context, error) {
  if (error != null) {
    trace(`${context}: ${error}\n`)
  }
}

function readAngle(servo, label, callback) {
  servo.readStatus((result) => {
    if (!result.success) {
      trace(`${label} read failed: ${result.reason}\n`)
      callback(undefined)
      return
    }
    callback(result.value.angle)
  })
}

function setOffsetAndSave(servo, label, angle) {
  servo.setOffsetAngle(angle - 90, (offsetError) => {
    if (offsetError != null) {
      traceError(`${label} offset failed`, offsetError)
      return
    }
    servo.saveSettings((saveError) => traceError(`${label} save failed`, saveError))
  })
}

function onContextCreated(robot) {
  const pan = robot._driver._pan
  const tilt = robot._driver._tilt
  robot.button.a.onEvent = (event) => {
    if (!event.pressed) {
      return
    }
    trace('setting pan offset\n')
    readAngle(pan, 'pan', (panAngle) => {
      if (panAngle !== undefined) setOffsetAndSave(pan, 'pan', panAngle)
    })
  }
  robot.button.b.onEvent = (event) => {
    if (!event.pressed) {
      return
    }
    trace('setting tilt offset\n')
    readAngle(tilt, 'tilt', (tiltAngle) => {
      if (tiltAngle !== undefined) setOffsetAndSave(tilt, 'tilt', tiltAngle)
    })
  }
  robot.button.c.onEvent = (event) => {
    if (!event.pressed) {
      return
    }
    trace('setting zero\n')
    tilt.setAngle(100, (tiltError) => {
      if (tiltError != null) {
        traceError('tilt angle failed', tiltError)
        return
      }
      pan.setAngle(100, (panError) => {
        if (panError != null) {
          traceError('pan angle failed', panError)
          return
        }
        Timer.set(() => {
          tilt.setTorque(false, (tiltTorqueError) => {
            if (tiltTorqueError != null) {
              traceError('tilt torque failed', tiltTorqueError)
              return
            }
            pan.setTorque(false, (panTorqueError) => traceError('pan torque failed', panTorqueError))
          })
        }, 500)
      })
    })
  }

  pan.setOffsetAngle(0, (error) => traceError('pan reset offset failed', error))
  tilt.setOffsetAngle(0, (error) => traceError('tilt reset offset failed', error))

  let polling = false
  Timer.repeat(() => {
    if (polling) {
      return
    }
    polling = true
    readAngle(pan, 'pan', (panAngle) => {
      if (panAngle === undefined) {
        polling = false
        return
      }
      readAngle(tilt, 'tilt', (tiltAngle) => {
        if (tiltAngle === undefined) {
          polling = false
          return
        }
        pan.readOffsetAngle((panOffsetResult) => {
          if (!panOffsetResult.success) {
            polling = false
            trace(`pan offset read failed: ${panOffsetResult.reason}\n`)
            return
          }
          tilt.readOffsetAngle((tiltOffsetResult) => {
            polling = false
            if (!tiltOffsetResult.success) {
              trace(`tilt offset read failed: ${tiltOffsetResult.reason}\n`)
              return
            }
            trace(
              `(pan, tilt) => (${panAngle}, ${tiltAngle}), (panOffset, tiltOffset) => (${panOffsetResult.value}, ${tiltOffsetResult.value})\n`,
            )
          })
        })
      })
    })
  }, 1000)
}

export default {
  onContextCreated,
}
