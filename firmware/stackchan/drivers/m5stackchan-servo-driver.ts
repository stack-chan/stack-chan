import SCServo from 'scservo'
import { getSharedPY32IOExpander } from 'py32-io-expander'
import type { Maybe, Rotation } from 'stackchan-util'
import {
  RAD_TO_01_DEGREE,
  angleToRawPosition,
  createM5StackChanServoConfig,
  rawPositionToAngle,
  rotationToM5StackChanServoAngles,
  type M5StackChanServoConfig,
} from 'm5stackchan-servo'

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

  async setTorque(torque: boolean): Promise<void> {
    await this.#pan.setTorque(torque)
    await this.#tilt.setTorque(torque)
  }

  async applyRotation(ori: Rotation, time = 0.5): Promise<void> {
    const angles = rotationToM5StackChanServoAngles(ori)
    const panRawPosition = angleToRawPosition(angles.yaw, this.#config.yaw)
    const tiltRawPosition = angleToRawPosition(angles.pitch, this.#config.pitch)
    if (time === 0) {
      await this.#pan.setRawPosition(panRawPosition)
      await this.#tilt.setRawPosition(tiltRawPosition)
    } else {
      const goalTime = time * 1000
      await this.#pan.setRawPositionInTime(panRawPosition, goalTime)
      await this.#tilt.setRawPositionInTime(tiltRawPosition, goalTime)
    }
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    const panStatus = await this.#pan.readRawPosition()
    if (!panStatus.success) {
      return {
        success: false,
      }
    }
    const tiltStatus = await this.#tilt.readRawPosition()
    if (!tiltStatus.success) {
      return {
        success: false,
      }
    }
    const yawAngle = rawPositionToAngle(panStatus.value.position, this.#config.yaw)
    const pitchAngle = rawPositionToAngle(tiltStatus.value.position, this.#config.pitch)
    return {
      success: true,
      value: {
        y: yawAngle / RAD_TO_01_DEGREE,
        p: -(pitchAngle / RAD_TO_01_DEGREE),
        r: 0.0,
      },
    }
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
