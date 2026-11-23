import { type Port as PiuPort, Texture } from 'piu/MC'

export type SpriteFrame = readonly [x: number, y: number, width: number, height: number, maskColor: number]

export const effectFrames = {
  heart: [0, 0, 44, 38, 0xff6b98],
  heartSquash: [44, 0, 44, 34, 0xff6b98],
  angry: [88, 0, 36, 40, 0xff705e],
  angryRebound: [124, 0, 36, 40, 0xff705e],
  gloomShort: [28, 96, 28, 8, 0xa795de],
  gloomLow: [76, 88, 28, 16, 0xa795de],
  gloomMedium: [28, 72, 28, 24, 0xa795de],
  gloomHigh: [0, 72, 28, 32, 0xa795de],
  gloomTall: [116, 40, 28, 40, 0xa795de],
  sweat: [76, 40, 20, 28, 0x70e5e7],
  smallSweat: [56, 80, 16, 20, 0x70e5e7],
  tear: [56, 40, 20, 28, 0x82baff],
  tearSplash: [56, 68, 20, 12, 0x82baff],
  smallTear: [76, 68, 16, 20, 0x82baff],
  mintNote: [0, 40, 28, 32, 0x85e6bb],
  goldNote: [28, 40, 28, 32, 0xffd174],
  sleepyBubble: [96, 40, 20, 24, 0x9bdeff],
  sleepyPop: [96, 64, 20, 16, 0x9bdeff],
  thinking: [116, 80, 28, 32, 0xffd36d],
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
      ((frame[4] << 8) | this.#alpha) >>> 0,
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
