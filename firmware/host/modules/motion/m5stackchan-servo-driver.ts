import {
  angleToRawPosition,
  createM5StackChanServoConfig,
  type M5StackChanServoConfig,
  RAD_TO_01_DEGREE,
  rawPositionToAngle,
  rotationToM5StackChanServoAngles,
  SCS_STEPS_PER_01_DEGREE,
} from 'm5stackchan-servo'
import {
  type MotionCompletion,
  type MotionDurationSeconds,
  type MotionResultCallback,
  motionDurationSecondsToMilliseconds,
} from 'motion-driver'
import { directMotionPort, type MotionPort, motionInfo } from 'motion-port'
import SCServo from 'protocols/scservo'
import { type PY32IOExpanderLease, tryAcquireSharedPY32IOExpander } from 'py32-io-expander'
import { ServoBusError } from 'servo-bus'
import { ServoDriverResources } from 'servo-driver-resources'
import type { Maybe, Rotation } from 'stackchan-util'

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
  readonly motion: MotionPort
  #resources = new ServoDriverResources()
  #pan: SCServo
  #tilt: SCServo
  #config: M5StackChanServoConfig
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #rotationErrorResult: { success: false; reason?: string } = { success: false }
  #servoPower?: {
    readonly available: boolean
    setEnabled: (enabled: boolean) => void
    close: () => void
  }

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
    try {
      this.#pan = this.#resources.own(
        new SCServo({ id: this.#config.yaw.id, serial: this.#config.serial, awaitWriteResponse: true }),
      )
      this.#tilt = this.#resources.own(
        new SCServo({ id: this.#config.pitch.id, serial: this.#config.serial, awaitWriteResponse: true }),
      )
      if (param.servoPower?.type !== 'none') {
        this.#servoPower = new PY32ServoPower(param.servoPower?.pin ?? 0, param.servoPower?.address)
        this.#resources.own(this.#servoPower)
      }
      const yaw = this.#config.yaw
      const pitch = this.#config.pitch
      this.motion = directMotionPort(
        this,
        this.#servoPower && !this.#servoPower.available
          ? { availability: 'unavailable', reason: 'Servo power controller is unavailable' }
          : motionInfo(
              'measured',
              [
                rawPositionToAngle(yaw.rawPositionLimit.min, yaw) / 10,
                rawPositionToAngle(yaw.rawPositionLimit.max, yaw) / 10,
              ],
              [
                -rawPositionToAngle(pitch.rawPositionLimit.max, pitch) / 10,
                -rawPositionToAngle(pitch.rawPositionLimit.min, pitch) / 10,
              ],
            ),
      )
    } catch (error) {
      this.#resources.rollback(error)
    }
  }

  close(): void {
    this.#resources.close()
  }

  onAttached() {
    if (this.#resources.closed) throw new ServoBusError('CLOSED', 'servo driver is closed')
    this.#servoPower?.setEnabled(true)
  }

  onDetached() {
    if (this.#resources.closed) return
    this.#servoPower?.setEnabled(false)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this.#pan.setTorque(torque, (panError) => {
      if (panError != null) {
        callback?.(panError)
        return
      }
      this.#tilt.setTorque(torque, callback)
    })
  }

  applyRotation(ori: Rotation, time: MotionDurationSeconds = 0.5, callback?: MotionCompletion): void {
    const angles = rotationToM5StackChanServoAngles(ori)
    const panRawPosition = angleToRawPosition(angles.yaw, this.#config.yaw)
    const tiltRawPosition = angleToRawPosition(angles.pitch, this.#config.pitch)
    if (time === 0) {
      this.#pan.setRawPosition(panRawPosition, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this.#tilt.setRawPosition(tiltRawPosition, callback)
      })
    } else {
      const goalTimeMilliseconds = motionDurationSecondsToMilliseconds(time)
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
        // Measurement must not clamp a physical position into the requested range.
        this.#rotation.y =
          (panStatus.value.position - this.#config.yaw.zeroPosition) / SCS_STEPS_PER_01_DEGREE / RAD_TO_01_DEGREE
        this.#rotation.p =
          -(tiltStatus.value.position - this.#config.pitch.zeroPosition) / SCS_STEPS_PER_01_DEGREE / RAD_TO_01_DEGREE
        this.#rotation.r = 0.0
        callback(this.#rotationResult)
      })
    })
  }

  #returnRotationError(callback: MotionResultCallback<Maybe<Rotation>>, reason?: string): void {
    this.#rotationErrorResult.reason = reason
    callback(this.#rotationErrorResult)
  }
}

class PY32ServoPower {
  #pin: number
  #expander?: PY32IOExpanderLease
  #closed = false

  get available(): boolean {
    return !this.#closed && this.#expander !== undefined
  }

  constructor(pin: number, address?: number) {
    this.#pin = pin
    const expander = tryAcquireSharedPY32IOExpander(address === undefined ? undefined : { address }, (error) => {
      trace(`[m5stackchan-servo] PY32 servo power init failed: ${error}\n`)
    })
    if (!expander) return
    this.#expander = expander
    try {
      expander.setDirection(this.#pin, true)
      expander.setPullMode(this.#pin, true)
      trace(`[m5stackchan-servo] configured PY32 servo power pin ${this.#pin}\n`)
    } catch (error) {
      try {
        this.close()
      } catch {
        /* Preserve initialization failure. */
      }
      throw error
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const lease = this.#expander
    this.#expander = undefined
    if (!lease) return
    let failed = false
    let failure: unknown
    try {
      lease.digitalWrite(this.#pin, false)
    } catch (error) {
      failed = true
      failure = error
    }
    try {
      lease.close()
    } catch (error) {
      if (!failed) {
        failed = true
        failure = error
      }
    }
    if (failed) throw failure
  }

  setEnabled(enabled: boolean) {
    if (this.#closed) throw new Error('servo power is closed')
    const expander = this.#expander
    if (!expander) return
    expander.digitalWrite(this.#pin, enabled)
    trace(`[m5stackchan-servo] servo power ${enabled ? 'on' : 'off'} (${expander.getWriteValue(this.#pin)})\n`)
  }
}
