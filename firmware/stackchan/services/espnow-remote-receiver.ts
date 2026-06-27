import EspNow from 'espnow'
import { parseEspNowRemotePacket, remoteSpeedToPoseTime } from 'espnow-remote-packet'
import type { Robot } from 'robot'
import Timer from 'timer'

const RAD_PER_01_DEGREE = Math.PI / 1800

export type EspNowRemoteReceiverOptions = {
  channel?: number
  receiverId?: number
  interval?: number
  ledName?: string
  laserBrightness?: number
}

export class EspNowRemoteReceiver {
  #robot: Robot
  #espnow: EspNow
  #receiverId: number
  #timer?: Timer
  #ledName: string
  #laserBrightness: number

  constructor(robot: Robot, options: EspNowRemoteReceiverOptions = {}) {
    this.#robot = robot
    this.#receiverId = options.receiverId ?? 1
    this.#ledName = options.ledName ?? 'head'
    this.#laserBrightness = options.laserBrightness ?? 24
    this.#espnow = new EspNow({ channel: options.channel ?? 1 })
    this.#timer = Timer.repeat(() => this.poll(), options.interval ?? 30)
  }

  close() {
    if (this.#timer) {
      Timer.clear(this.#timer)
      this.#timer = undefined
    }
    this.#espnow.close()
  }

  poll() {
    const data = this.#espnow.read()
    if (!data) {
      return
    }

    const packet = parseEspNowRemotePacket(data, this.#receiverId)
    if (!packet) {
      return
    }

    void this.#robot.setPose(
      {
        position: {
          x: 0,
          y: 0,
          z: 0,
        },
        rotation: {
          y: packet.yaw * RAD_PER_01_DEGREE,
          p: -packet.pitch * RAD_PER_01_DEGREE,
          r: 0,
        },
      },
      remoteSpeedToPoseTime(packet.speed),
    )

    if (packet.laserEnabled) {
      this.#robot.lightOn(this.#ledName, this.#laserBrightness, 0, 0)
    } else {
      this.#robot.lightOff(this.#ledName)
    }
  }
}
