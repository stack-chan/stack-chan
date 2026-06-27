import EspNow from 'espnow'
import { createEspNowRemotePacket, rotationToEspNowRemoteAngles } from 'espnow-remote-packet'
import type { Robot } from 'robot'
import Timer from 'timer'

export type EspNowRemoteSenderOptions = {
  channel?: number
  targetId?: number
  interval?: number
  speed?: number
  laserEnabled?: boolean
}

export class EspNowRemoteSender {
  #robot: Robot
  #espnow: EspNow
  #targetId: number
  #speed: number
  #laserEnabled: boolean
  #timer?: Timer
  #sending = false

  constructor(robot: Robot, options: EspNowRemoteSenderOptions = {}) {
    this.#robot = robot
    this.#targetId = options.targetId ?? 0
    this.#speed = options.speed ?? 600
    this.#laserEnabled = options.laserEnabled ?? false
    this.#espnow = new EspNow({ channel: options.channel ?? 1 })
    this.#timer = Timer.repeat(() => {
      void this.sendCurrentPose()
    }, options.interval ?? 50)
  }

  close() {
    if (this.#timer) {
      Timer.clear(this.#timer)
      this.#timer = undefined
    }
    this.#espnow.close()
  }

  async sendCurrentPose() {
    if (this.#sending) {
      return
    }
    this.#sending = true
    try {
      const rotation = await this.#robot.driver.getRotation()
      if (!rotation.success) {
        return
      }
      const angles = rotationToEspNowRemoteAngles(rotation.value)
      this.#espnow.send(
        createEspNowRemotePacket({
          targetId: this.#targetId,
          yaw: angles.yaw,
          pitch: angles.pitch,
          speed: this.#speed,
          laserEnabled: this.#laserEnabled,
        }),
      )
    } finally {
      this.#sending = false
    }
  }
}
