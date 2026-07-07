import Timer from 'timer'

/**
 * @brief calibrates SCServo offset angle
 * @note This mod is under construction. setting pan/tilt offset does not work properly.
 * @param {*} context - Stack-chan runtime context
 */
function traceError(context, error) {
  if (error != null) {
    trace(`${context}: ${error}\n`)
  }
}

function readAngle(servo, label, callback) {
  servo.readAngle((result) => {
    if (!result.success) {
      trace(`${label} read failed: ${result.reason}\n`)
      callback(undefined)
      return
    }
    callback(result.value)
  })
}

function setOffsetAndSave(servo, label, angle) {
  if (servo.setOffsetAngle == null || servo.saveSettings == null) {
    trace(`${label} offset calibration is not supported\n`)
    return
  }
  servo.setOffsetAngle(angle - 90, (offsetError) => {
    if (offsetError != null) {
      traceError(`${label} offset failed`, offsetError)
      return
    }
    servo.saveSettings((saveError) => traceError(`${label} save failed`, saveError))
  })
}

function onContextCreated(context) {
  const calibration = context.motion.calibration
  const pan = calibration?.pan
  const tilt = calibration?.tilt
  const buttons = context.input.button
  const buttonA = buttons?.a
  const buttonB = buttons?.b
  const buttonC = buttons?.c

  if (pan == null || tilt == null || buttons == null) {
    trace('calibration requires motion calibration support and buttons\n')
    return
  }

  if (buttonA != null) {
    buttonA.onEvent = (event) => {
      if (!event.pressed) {
        return
      }
      trace('setting pan offset\n')
      readAngle(pan, 'pan', (panAngle) => {
        if (panAngle !== undefined) setOffsetAndSave(pan, 'pan', panAngle)
      })
    }
  }
  if (buttonB != null) {
    buttonB.onEvent = (event) => {
      if (!event.pressed) {
        return
      }
      trace('setting tilt offset\n')
      readAngle(tilt, 'tilt', (tiltAngle) => {
        if (tiltAngle !== undefined) setOffsetAndSave(tilt, 'tilt', tiltAngle)
      })
    }
  }

  if (buttonC != null) {
    buttonC.onEvent = (event) => {
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
  }

  pan.setOffsetAngle?.(0, (error) => traceError('pan reset offset failed', error))
  tilt.setOffsetAngle?.(0, (error) => traceError('tilt reset offset failed', error))

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
        if (pan.readOffsetAngle == null || tilt.readOffsetAngle == null) {
          polling = false
          trace(`(pan, tilt) => (${panAngle}, ${tiltAngle}), offset read is not supported\n`)
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
