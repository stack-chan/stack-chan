import { type Port as PiuPort, Texture } from 'piu/MC'

export type SpriteFrame = readonly [x: number, y: number, width: number, height: number]

export const effectFrames = {
  heart: [0, 0, 22, 20],
  heartSquash: [22, 0, 22, 20],
  angry: [44, 0, 18, 20],
  angryRebound: [62, 0, 18, 20],
  gloom: [0, 20, 14, 20],
  sweat: [14, 20, 10, 14],
  sweatSplash: [14, 34, 10, 6],
  tear: [24, 20, 10, 14],
  tearSplash: [24, 34, 10, 6],
  mintNote: [34, 20, 14, 16],
  goldNote: [48, 20, 14, 16],
  smallSweat: [62, 20, 8, 10],
  smallTear: [62, 30, 8, 10],
  sleepyBubble: [70, 20, 10, 12],
  sleepyPop: [70, 32, 10, 8],
} as const satisfies Record<string, SpriteFrame>

let texture: Texture | undefined

export class EffectSprite {
  #frame: SpriteFrame | null = null
  #x = 0
  #y = 0
  #alpha = 0

  place(port: PiuPort, frame: SpriteFrame, centerX: number, centerY: number, alpha = 255): void {
    const x = Math.round(centerX - frame[2] / 2)
    const y = Math.round(centerY - frame[3] / 2)
    if (this.#frame === frame && this.#x === x && this.#y === y && this.#alpha === alpha) return

    const oldFrame = this.#frame
    if (oldFrame) {
      this.#invalidate(
        port,
        Math.min(x, this.#x),
        Math.min(y, this.#y),
        Math.max(x + frame[2], this.#x + oldFrame[2]),
        Math.max(y + frame[3], this.#y + oldFrame[3]),
      )
    } else {
      this.#invalidate(port, x, y, x + frame[2], y + frame[3])
    }
    this.#frame = frame
    this.#x = x
    this.#y = y
    this.#alpha = alpha
  }

  hide(port: PiuPort): void {
    const frame = this.#frame
    if (!frame) return
    this.#frame = null
    this.#invalidate(port, this.#x, this.#y, this.#x + frame[2], this.#y + frame[3])
  }

  draw(port: PiuPort): void {
    const frame = this.#frame
    if (!frame) return
    const x = this.#x
    const y = this.#y
    // PiuはPortの削除時にPortの範囲だけを再描画するため、スプライトもその範囲に収める
    const left = Math.max(0, x)
    const top = Math.max(0, y)
    const right = Math.min(port.width, x + frame[2])
    const bottom = Math.min(port.height, y + frame[3])
    if (right <= left || bottom <= top) return

    texture ??= new Texture('emoticon.png')
    port.drawTexture(
      texture,
      (0xffffff00 + this.#alpha) >>> 0,
      left,
      top,
      frame[0] + left - x,
      frame[1] + top - y,
      right - left,
      bottom - top,
    )
  }

  #invalidate(port: PiuPort, x: number, y: number, endX: number, endY: number): void {
    const left = Math.max(0, x)
    const top = Math.max(0, y)
    const right = Math.min(port.width, endX)
    const bottom = Math.min(port.height, endY)
    if (right > left && bottom > top) port.invalidate(left, top, right - left, bottom - top)
  }
}
