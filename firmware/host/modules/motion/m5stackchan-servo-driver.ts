import {
  angleToRawPosition,
  createM5StackChanServoConfig,
  type M5StackChanServoConfig,
  RAD_TO_01_DEGREE,
  rawPositionToAngle,
  rotationToM5StackChanServoAngles,
} from 'm5stackchan-servo'
import type { MotionCompletion, MotionResultCallback } from 'motion-controller'
import SCServo from 'protocols/scservo'
import { getSharedPY32IOExpander } from 'py32-io-expander'
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
  #pan: SCServo
  #tilt: SCServo
  #config: M5StackChanServoConfig
  #servoPower?: {
    setEnabled: (enabled: boolean) => void
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
    this.#pan = new SCServo({ id: this.#config.yaw.id, serial: this.#config.serial, awaitWriteResponse: false })
    this.#tilt = new SCServo({ id: this.#config.pitch.id, serial: this.#config.serial, awaitWriteResponse: false })
    if (param.servoPower?.type !== 'none') {
      try {
        this.#servoPower = new PY32ServoPower(param.servoPower?.pin ?? 0, param.servoPower?.address)
      } catch (error) {
        trace(`[m5stackchan-servo] PY32 servo power init failed: ${error}\n`)
      }
    }
  }

  onAttached() {
    this.#servoPower?.setEnabled(true)
  }

  onDetached() {
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

  applyRotation(ori: Rotation, time = 0.5, callback?: MotionCompletion): void {
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
      const goalTime = time * 1000
      this.#pan.setRawPositionInTime(panRawPosition, goalTime, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this.#tilt.setRawPositionInTime(tiltRawPosition, goalTime, callback)
      })
    }
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    this.#pan.readRawPosition((panStatus) => {
      if (panStatus.success === false) {
        callback({
          success: false,
          reason: panStatus.reason,
        })
        return
      }
      this.#tilt.readRawPosition((tiltStatus) => {
        if (tiltStatus.success === false) {
          callback({
            success: false,
            reason: tiltStatus.reason,
          })
          return
        }
        const yawAngle = rawPositionToAngle(panStatus.value.position, this.#config.yaw)
        const pitchAngle = rawPositionToAngle(tiltStatus.value.position, this.#config.pitch)
        callback({
          success: true,
          value: {
            y: yawAngle / RAD_TO_01_DEGREE,
            p: -(pitchAngle / RAD_TO_01_DEGREE),
            r: 0.0,
          },
        })
      })
    })
  }
}

class PY32ServoPower {
  #pin: number
  #expander: ReturnType<typeof getSharedPY32IOExpander>

  constructor(pin: number, address?: number) {
    this.#pin = pin
    this.#expander = getSharedPY32IOExpander(address === undefined ? undefined : { address })
    this.#expander.setDirection(this.#pin, true)
    this.#expander.setPullMode(this.#pin, true)
    trace(`[m5stackchan-servo] configured PY32 servo power pin ${this.#pin}\n`)
  }

  setEnabled(enabled: boolean) {
    this.#expander.digitalWrite(this.#pin, enabled)
    trace(`[m5stackchan-servo] servo power ${enabled ? 'on' : 'off'} (${this.#expander.getWriteValue(this.#pin)})\n`)
  }
}
