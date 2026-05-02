import SCServo from 'scservo'
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
    yaw: Partial<M5StackChanServoConfig['yaw']>
    pitch: Partial<M5StackChanServoConfig['pitch']>
  }>
}>

export class M5StackChanServoDriver {
  _pan: SCServo
  _tilt: SCServo
  _config: M5StackChanServoConfig

  constructor(param: M5StackChanServoDriverProps = {}) {
    this._config = createM5StackChanServoConfig({
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
    this._pan = new SCServo({ id: this._config.yaw.id })
    this._tilt = new SCServo({ id: this._config.pitch.id })
  }

  async setTorque(torque: boolean): Promise<void> {
    await Promise.all([this._pan.setTorque(torque), this._tilt.setTorque(torque)])
  }

  async applyRotation(ori: Rotation, time = 0.5): Promise<void> {
    const angles = rotationToM5StackChanServoAngles(ori)
    const panRawPosition = angleToRawPosition(angles.yaw, this._config.yaw)
    const tiltRawPosition = angleToRawPosition(angles.pitch, this._config.pitch)
    trace(
      `m5stackchan applying (${ori.y}, ${ori.p}) => angle(${angles.yaw}, ${angles.pitch}) raw(${panRawPosition}, ${tiltRawPosition})\n`,
    )

    if (time === 0) {
      await Promise.all([this._pan.setRawPosition(panRawPosition), this._tilt.setRawPosition(tiltRawPosition)])
    } else {
      await Promise.all([
        this._pan.setRawPositionInTime(panRawPosition, time * 1000),
        this._tilt.setRawPositionInTime(tiltRawPosition, time * 1000),
      ])
    }
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    const [p1, p2] = await Promise.allSettled([this._pan.readStatus(), this._tilt.readStatus()])
    if (p1.status !== 'fulfilled' || p2.status !== 'fulfilled') {
      return
    }
    if (!p1.value.success || !p2.value.success) {
      return {
        success: false,
      }
    }
    const yawAngle = (p1.value.value.angle * 1024) / 200
    const pitchAngle = (p2.value.value.angle * 1024) / 200
    const y = ((yawAngle - this._config.yaw.zeroPosition) * 5 * 10 * Math.PI) / (16 * 1800)
    const p = ((pitchAngle - this._config.pitch.zeroPosition) * 5 * 10 * Math.PI) / (16 * 1800)
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
