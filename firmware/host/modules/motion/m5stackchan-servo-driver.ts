import {
  angleToRawPosition,
  createM5StackChanServoConfig,
  type M5StackChanServoConfig,
  RAD_TO_01_DEGREE,
  rawPositionToAngle,
  rotationToM5StackChanServoAngles,
} from 'm5stackchan-servo'
import {
  type ContinuousYawDriver,
  type MotionCompletion,
  type MotionDurationSeconds,
  type MotionResultCallback,
  motionDurationSecondsToMilliseconds,
} from 'motion-controller'
import SCServo, { type SCServoAngleLimits } from 'protocols/scservo'
import { type PY32IOExpander, tryGetSharedPY32IOExpander } from 'py32-io-expander'
import type { Maybe, Rotation } from 'stackchan-util'
import Timer from 'timer'

type M5StackChanServoDriverProps = Partial<{
  panId: number
  tiltId: number
  yawZeroPosition: number
  pitchZeroPosition: number
  config: Partial<{
    serial: Partial<M5StackChanServoConfig['serial']>
    yaw: Partial<M5StackChanServoConfig['yaw']>
    pitch: Partial<M5StackChanServoConfig['pitch']>
  }>
  serial: Partial<M5StackChanServoConfig['serial']>
  servoPower: {
    type?: 'py32' | 'none'
    pin?: number
    address?: number
  }
}>

export class M5StackChanServoDriver {
  #pan: SCServo
  #tilt: SCServo
  #config: M5StackChanServoConfig
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #rotationErrorResult: { success: false; reason?: string } = { success: false }
  #servoPower?: PY32ServoPower
  #positionLimits?: SCServoAngleLimits
  #servoFault?: Error
  #enableYawOnPose = false
  readonly continuousYaw?: ContinuousYawDriver

  constructor(param: M5StackChanServoDriverProps = {}) {
    this.#config = createM5StackChanServoConfig({
      serial: {
        ...param.config?.serial,
        ...param.serial,
      },
      yaw: {
        ...param.config?.yaw,
        ...(param.panId !== undefined ? { id: param.panId } : {}),
        ...(param.yawZeroPosition !== undefined ? { zeroPosition: param.yawZeroPosition } : {}),
      },
      pitch: {
        ...param.config?.pitch,
        ...(param.tiltId !== undefined ? { id: param.tiltId } : {}),
        ...(param.pitchZeroPosition !== undefined ? { zeroPosition: param.pitchZeroPosition } : {}),
      },
    })
    this.#pan = new SCServo({ id: this.#config.yaw.id, serial: this.#config.serial, awaitWriteResponse: true })
    this.#tilt = new SCServo({ id: this.#config.pitch.id, serial: this.#config.serial, awaitWriteResponse: true })
    if (param.servoPower?.type !== 'none') {
      this.#servoPower = new PY32ServoPower(param.servoPower?.pin ?? 0, param.servoPower?.address)
    }
    if (param.servoPower?.type === 'py32' && this.#servoPower?.available) {
      this.continuousYaw = {
        start: (done) => this.#startContinuousYaw(done),
        setPower: (power, done) => this.#pan.setPwmDuty(power, done),
        readRawPosition: (done) =>
          this.#pan.readRawPosition((result) => {
            if (result.success === false) done(new Error(result.reason ?? 'Yaw servo read failed'))
            else done(undefined, result.value.position)
          }, true),
        stop: (done) => this.#stopContinuousYaw(done),
      }
    }
  }

  onAttached() {
    this.#servoPower?.setEnabled(true)
    this.#servoFault = undefined
    this.#enableYawOnPose = false
  }

  onDetached() {
    this.#servoPower?.setEnabled(false)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    if (this.#servoFault) {
      callback?.(this.#servoFault)
      return
    }
    this.#enableYawOnPose = false
    this.#pan.setTorque(torque, (panError) => {
      if (panError != null) {
        callback?.(panError)
        return
      }
      this.#tilt.setTorque(torque, callback)
    })
  }

  applyRotation(ori: Rotation, time: MotionDurationSeconds = 0.5, callback?: MotionCompletion): void {
    if (this.#servoFault) {
      callback?.(this.#servoFault)
      return
    }
    const angles = rotationToM5StackChanServoAngles(ori)
    const panRawPosition = angleToRawPosition(angles.yaw, this.#config.yaw)
    const tiltRawPosition = angleToRawPosition(angles.pitch, this.#config.pitch)
    const goalTimeMilliseconds = motionDurationSecondsToMilliseconds(time)
    if (this.#enableYawOnPose) {
      runCommands(
        [
          // Stage the new goal while torque is off so enabling yaw cannot act on a latched target.
          (done) => {
            if (time === 0) this.#pan.setRawPosition(panRawPosition, done, true)
            else this.#pan.setRawPositionInTime(panRawPosition, goalTimeMilliseconds, done, true)
          },
          (done) => {
            if (!this.#enableYawOnPose) return done()
            this.#pan.setTorque(
              true,
              (error) => {
                if (error == null) this.#enableYawOnPose = false
                done(error)
              },
              true,
            )
          },
          (done) => {
            if (time === 0) this.#tilt.setRawPosition(tiltRawPosition, done)
            else this.#tilt.setRawPositionInTime(tiltRawPosition, goalTimeMilliseconds, done)
          },
        ],
        callback,
      )
      return
    }
    if (time === 0) {
      this.#pan.setRawPosition(panRawPosition, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this.#tilt.setRawPosition(tiltRawPosition, callback)
      })
    } else {
      this.#pan.setRawPositionInTime(panRawPosition, goalTimeMilliseconds, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this.#tilt.setRawPositionInTime(tiltRawPosition, goalTimeMilliseconds, callback)
      })
    }
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    if (this.#servoFault) {
      this.#returnRotationError(callback, this.#servoFault.message)
      return
    }
    this.#pan.readRawPosition((panStatus) => {
      if (panStatus.success === false) {
        this.#returnRotationError(callback, panStatus.reason)
        return
      }
      this.#tilt.readRawPosition((tiltStatus) => {
        if (tiltStatus.success === false) {
          this.#returnRotationError(callback, tiltStatus.reason)
          return
        }
        const yawAngle = rawPositionToAngle(panStatus.value.position, this.#config.yaw)
        const pitchAngle = rawPositionToAngle(tiltStatus.value.position, this.#config.pitch)
        this.#rotation.y = yawAngle / RAD_TO_01_DEGREE
        this.#rotation.p = -(pitchAngle / RAD_TO_01_DEGREE)
        this.#rotation.r = 0.0
        callback(this.#rotationResult)
      })
    })
  }

  #startContinuousYaw(complete: MotionCompletion): void {
    if (this.#servoFault) {
      complete(this.#servoFault)
      return
    }
    this.#pan.readAngleLimits((result) => {
      if (result.success === false) return complete(new Error(result.reason ?? 'Yaw servo read failed'))
      const limits = result.value
      if (limits.min >= limits.max || limits.max > 1023) {
        return complete(this.#cutServoPower(new Error('Yaw servo did not report valid position limits')))
      }
      runCommands(
        [
          (done) => this.#disableYawTorque(done),
          (done) => {
            this.#positionLimits = limits
            this.#setAngleLimits({ min: 0, max: 0 }, done)
          },
          (done) => this.#pan.setPwmDuty(0, done),
          (done) => this.#pan.setTorque(true, done, true),
        ],
        complete,
      )
    })
  }

  #stopContinuousYaw(complete: MotionCompletion): void {
    const limits = this.#positionLimits
    if (!limits) {
      complete()
      return
    }
    this.#positionLimits = undefined
    runCommands(
      [
        // Disable torque before restoring position mode so a latched angle target cannot move the head.
        (done) =>
          this.#pan.setPwmDuty(0, (pwmError) => {
            this.#disableYawTorque((torqueError) => done(torqueError ?? pwmError))
          }),
        (done) => this.#setAngleLimits(limits, done),
      ],
      (error) => {
        if (error != null) return complete(this.#cutServoPower(error))
        this.#enableYawOnPose = true
        complete()
      },
    )
  }

  #disableYawTorque(complete: MotionCompletion): void {
    runCommands(
      [
        (done) => this.#pan.setTorque(false, done, true),
        (done) =>
          this.#pan.readTorque((result) => {
            if (result.success === false) return done(new Error(result.reason ?? 'Yaw servo read failed'))
            done(result.value ? new Error('Yaw servo torque is still enabled') : undefined)
          }),
      ],
      complete,
    )
  }

  #setAngleLimits(limits: SCServoAngleLimits, complete: MotionCompletion): void {
    runCommands(
      [
        (done) => this.#pan.enableAngleLimitWriteLock(done),
        (done) => this.#pan.setAngleLimits(limits, done),
        (done) =>
          this.#pan.readAngleLimits((result) => {
            if (result.success === false) return done(new Error(result.reason ?? 'Yaw servo read failed'))
            const current = result.value
            if (current.min !== limits.min || current.max !== limits.max) {
              return done(new Error('Yaw servo did not apply the angle limits'))
            }
            done()
          }),
      ],
      complete,
    )
  }

  #cutServoPower(error: unknown): Error {
    this.#servoFault = new Error('Yaw servo control failed', { cause: error })
    try {
      if (this.#servoPower?.setEnabled(false) !== false) throw new Error('Servo power cutoff did not take effect')
    } catch (powerError) {
      this.#servoFault = new AggregateError([error, powerError], 'Yaw servo control and power cutoff failed')
    }
    return this.#servoFault
  }

  #returnRotationError(callback: MotionResultCallback<Maybe<Rotation>>, reason?: string): void {
    this.#rotationErrorResult.reason = reason
    callback(this.#rotationErrorResult)
  }
}

function runCommands(commands: Array<(done: MotionCompletion) => void>, complete?: MotionCompletion): void {
  let index = 0
  const next: MotionCompletion = (error) => {
    // Leave the Serial.onReadable stack before issuing another command.
    Timer.set(() => {
      if (error != null || index === commands.length) {
        complete?.(error)
        return
      }
      try {
        commands[index++](next)
      } catch (commandError) {
        complete?.(commandError)
      }
    }, 0)
  }
  next()
}

class PY32ServoPower {
  #pin: number
  #expander?: PY32IOExpander

  constructor(pin: number, address?: number) {
    this.#pin = pin
    const expander = tryGetSharedPY32IOExpander(address === undefined ? undefined : { address }, (error) => {
      trace(`[m5stackchan-servo] PY32 servo power init failed: ${error}\n`)
    })
    if (!expander) return
    this.#expander = expander
    expander.setDirection(this.#pin, true)
    expander.setPullMode(this.#pin, true)
    trace(`[m5stackchan-servo] configured PY32 servo power pin ${this.#pin}\n`)
  }

  get available(): boolean {
    return this.#expander !== undefined
  }

  setEnabled(enabled: boolean): boolean | undefined {
    const expander = this.#expander
    if (!expander) return
    expander.digitalWrite(this.#pin, enabled)
    const actual = expander.getWriteValue(this.#pin)
    trace(`[m5stackchan-servo] servo power ${enabled ? 'on' : 'off'} (${actual})\n`)
    return actual
  }
}
