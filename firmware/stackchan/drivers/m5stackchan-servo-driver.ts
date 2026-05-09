import SCServo from 'scservo'
import { getSharedPY32IOExpander } from 'py32-io-expander'
import type { Maybe, Rotation } from 'stackchan-util'
import {
  angleToRawPosition,
  createM5StackChanServoConfig,
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
  _pan: SCServo
  _tilt: SCServo
  _config: M5StackChanServoConfig
  _servoPower?: {
    setEnabled: (enabled: boolean) => void
  }

  constructor(param: M5StackChanServoDriverProps = {}) {
    this._config = createM5StackChanServoConfig({
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
    this._pan = new SCServo({ id: this._config.yaw.id, serial: this._config.serial, awaitWriteResponse: false })
    this._tilt = new SCServo({ id: this._config.pitch.id, serial: this._config.serial, awaitWriteResponse: false })
    if (param.servoPower?.type !== 'none') {
      try {
        this._servoPower = new PY32ServoPower(param.servoPower?.pin ?? 0, param.servoPower?.address)
      } catch (error) {
        trace(`[m5stackchan-servo] PY32 servo power init failed: ${error}\n`)
      }
    }
  }

  onAttached() {
    this._servoPower?.setEnabled(true)
  }

  onDetached() {
    this._servoPower?.setEnabled(false)
  }

  async setTorque(torque: boolean): Promise<void> {
    await this._pan.setTorque(torque)
    await this._tilt.setTorque(torque)
  }

  async applyRotation(ori: Rotation, time = 0.5): Promise<void> {
    const angles = rotationToM5StackChanServoAngles(ori)
    const panRawPosition = angleToRawPosition(angles.yaw, this._config.yaw)
    const tiltRawPosition = angleToRawPosition(angles.pitch, this._config.pitch)
    if (time === 0) {
      await this._pan.setRawPosition(panRawPosition)
      await this._tilt.setRawPosition(tiltRawPosition)
    } else {
      const goalTime = time * 1000
      await this._pan.setRawPositionInTime(panRawPosition, goalTime)
      await this._tilt.setRawPositionInTime(tiltRawPosition, goalTime)
    }
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    const panStatus = await this._pan.readStatus()
    if (!panStatus.success) {
      return {
        success: false,
      }
    }
    const tiltStatus = await this._tilt.readStatus()
    if (!tiltStatus.success) {
      return {
        success: false,
      }
    }
    const yawRawPosition = (panStatus.value.angle * 1024) / 200
    const pitchRawPosition = (tiltStatus.value.angle * 1024) / 200
    const y = ((yawRawPosition - this._config.yaw.zeroPosition) * 5 * 10 * Math.PI) / (16 * 1800)
    const p = -((pitchRawPosition - this._config.pitch.zeroPosition) * 5 * 10 * Math.PI) / (16 * 1800)
    return {
      success: true,
      value: {
        y,
        p,
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
