import type { MiniAppDefinition } from 'capabilities'
import 'piu/MC'
import type { Port as PiuPort, Texture as PiuTexture } from 'piu/MC'

const FRAME_INTERVAL_MS = 40
const SPRITE_SIZE = 32
const PLAYER_X = 48
const GROUND_BOTTOM = 18
const INITIAL_SPEED = 4
const MAX_SPEED = 8
const JUMP_VELOCITY = -11
const GRAVITY = 1

const COLOR_BACKGROUND = '#f7f3df'
const COLOR_GROUND = '#29323c'
const COLOR_OBSTACLE = '#397b44'
const COLOR_CLOUD = '#ffffff'
const COLOR_SCORE = '#29323c'
const COLOR_ACCENT = '#dc5b45'
const COLOR_OVERLAY = '#f7f3dfe6'

const DIGIT_MASKS = Object.freeze([
  0b111101101101111, 0b010110010010111, 0b111001111100111, 0b111001111001111, 0b101101111001001, 0b111100111001111,
  0b111100111101111, 0b111001001001001, 0b111101111101111, 0b111101111001111,
])
const OBSTACLE_HEIGHTS = Object.freeze([28, 36, 44, 32, 40])
const OBSTACLE_WIDTHS = Object.freeze([14, 18, 16, 20, 14])
const OBSTACLE_GAPS = Object.freeze([88, 120, 104, 144, 112])

const background = new Skin({ fill: COLOR_BACKGROUND })
let stackchanTexture: PiuTexture | undefined

function getStackchanTexture(): PiuTexture {
  stackchanTexture ??= new Texture('stack-chan.png')
  return stackchanTexture
}

class StackchanJumpBehavior extends Behavior {
  #groundY = 0
  #playerY = 0
  #velocityY = 0
  #onGround = true
  #obstacleX = 0
  #obstacleWidth = OBSTACLE_WIDTHS[0]
  #obstacleHeight = OBSTACLE_HEIGHTS[0]
  #spawnIndex = 0
  #score = 0
  #speed = INITIAL_SPEED
  #animationTick = 0
  #animationFrame = 0
  #hasJumped = false
  #gameOver = false

  get jumping(): boolean {
    return !this.#onGround && !this.#gameOver
  }

  get score(): number {
    return this.#score
  }

  onDisplaying(port: PiuPort): void {
    port.interval = FRAME_INTERVAL_MS
    this.#reset(port)
    port.start()
  }

  onUndisplaying(port: PiuPort): void {
    port.stop()
  }

  onTouchBegan(port: PiuPort): void {
    if (this.#gameOver) {
      this.#reset(port)
      port.start()
      return
    }
    if (!this.#onGround) return
    this.#hasJumped = true
    this.#onGround = false
    this.#velocityY = JUMP_VELOCITY
    this.#animationFrame = 0
    port.invalidate()
  }

  onTouchEnded(): void {}

  onTimeChanged(port: PiuPort): void {
    if (this.#gameOver) return

    const oldPlayerY = this.#playerY
    const oldObstacleX = this.#obstacleX

    if (!this.#onGround) {
      this.#velocityY += GRAVITY
      this.#playerY += this.#velocityY
      const floorY = this.#groundY - SPRITE_SIZE
      if (this.#playerY >= floorY) {
        this.#playerY = floorY
        this.#velocityY = 0
        this.#onGround = true
      }
    }

    this.#obstacleX -= this.#speed
    this.#animationTick += 1
    if (this.#animationTick >= 3) {
      this.#animationTick = 0
      this.#animationFrame = (this.#animationFrame + 1) & 3
    }

    if (this.#obstacleX + this.#obstacleWidth < 0) {
      this.#score += 1
      this.#speed = Math.min(MAX_SPEED, INITIAL_SPEED + (this.#score >> 2))
      this.#spawnObstacle(port)
      port.invalidate()
    } else {
      this.#invalidateSprite(port, oldPlayerY)
      this.#invalidateSprite(port, this.#playerY)
      this.#invalidateObstacle(port, oldObstacleX)
      this.#invalidateObstacle(port, this.#obstacleX)
    }

    if (!this.#collides()) return
    this.#gameOver = true
    port.stop()
    port.invalidate()
  }

  onDraw(port: PiuPort, x = 0, y = 0, width = port.width, height = port.height): void {
    port.fillColor(COLOR_BACKGROUND, x, y, width, height)
    this.#drawClouds(port)
    this.#drawGround(port)
    this.#drawObstacle(port)
    this.#drawPlayer(port)
    this.#drawScore(port)
    if (!this.#hasJumped && !this.#gameOver) this.#drawJumpHint(port)
    if (this.#gameOver) this.#drawGameOver(port)
  }

  #reset(port: PiuPort): void {
    this.#groundY = port.height - GROUND_BOTTOM
    this.#playerY = this.#groundY - SPRITE_SIZE
    this.#velocityY = 0
    this.#onGround = true
    this.#spawnIndex = 0
    this.#score = 0
    this.#speed = INITIAL_SPEED
    this.#animationTick = 0
    this.#animationFrame = 0
    this.#hasJumped = false
    this.#gameOver = false
    this.#spawnObstacle(port, true)
    port.invalidate()
  }

  #spawnObstacle(port: PiuPort, initial = false): void {
    const index = this.#spawnIndex
    this.#obstacleWidth = OBSTACLE_WIDTHS[index]
    this.#obstacleHeight = OBSTACLE_HEIGHTS[index]
    this.#obstacleX = port.width + (initial ? 72 : OBSTACLE_GAPS[index])
    this.#spawnIndex = (index + 1) % OBSTACLE_HEIGHTS.length
  }

  #collides(): boolean {
    const playerLeft = PLAYER_X + 6
    const playerRight = PLAYER_X + SPRITE_SIZE - 5
    const playerTop = this.#playerY + 4
    const playerBottom = this.#playerY + SPRITE_SIZE - 2
    const obstacleTop = this.#groundY - this.#obstacleHeight
    return (
      playerRight > this.#obstacleX &&
      playerLeft < this.#obstacleX + this.#obstacleWidth &&
      playerBottom > obstacleTop &&
      playerTop < this.#groundY
    )
  }

  #invalidateSprite(port: PiuPort, playerY: number): void {
    this.#invalidateArea(port, PLAYER_X - 1, playerY - 1, SPRITE_SIZE + 2, SPRITE_SIZE + 2)
  }

  #invalidateObstacle(port: PiuPort, obstacleX: number): void {
    this.#invalidateArea(
      port,
      obstacleX - 2,
      this.#groundY - this.#obstacleHeight - 1,
      this.#obstacleWidth + 4,
      this.#obstacleHeight + 2,
    )
  }

  #invalidateArea(port: PiuPort, x: number, y: number, width: number, height: number): void {
    const left = Math.max(0, x)
    const top = Math.max(0, y)
    const right = Math.min(port.width, x + width)
    const bottom = Math.min(port.height, y + height)
    if (right > left && bottom > top) port.invalidate(left, top, right - left, bottom - top)
  }

  #drawClouds(port: PiuPort): void {
    port.fillColor(COLOR_CLOUD, 208, 28, 48, 8)
    port.fillColor(COLOR_CLOUD, 218, 20, 28, 8)
    port.fillColor(COLOR_CLOUD, 274, 60, 30, 6)
    port.fillColor(COLOR_CLOUD, 280, 54, 18, 6)
  }

  #drawGround(port: PiuPort): void {
    port.fillColor(COLOR_GROUND, 0, this.#groundY, port.width, 3)
    port.fillColor(COLOR_GROUND, 24, this.#groundY + 8, 18, 2)
    port.fillColor(COLOR_GROUND, 116, this.#groundY + 10, 26, 2)
    port.fillColor(COLOR_GROUND, 244, this.#groundY + 7, 20, 2)
  }

  #drawPlayer(port: PiuPort): void {
    const sourceY = this.#onGround && !this.#gameOver ? 0 : SPRITE_SIZE
    port.drawTexture(
      getStackchanTexture(),
      '#ffffff',
      PLAYER_X,
      this.#playerY,
      this.#animationFrame * SPRITE_SIZE,
      sourceY,
      SPRITE_SIZE,
      SPRITE_SIZE,
    )
  }

  #drawObstacle(port: PiuPort): void {
    const x = this.#obstacleX
    const top = this.#groundY - this.#obstacleHeight
    const stemX = x + ((this.#obstacleWidth - 8) >> 1)
    port.fillColor(COLOR_OBSTACLE, stemX, top, 8, this.#obstacleHeight)
    port.fillColor(COLOR_OBSTACLE, x, top + 10, 6, 8)
    port.fillColor(COLOR_OBSTACLE, x, top + 10, 3, 15)
    port.fillColor(COLOR_OBSTACLE, x + this.#obstacleWidth - 6, top + 17, 6, 7)
    port.fillColor(COLOR_OBSTACLE, x + this.#obstacleWidth - 3, top + 10, 3, 14)
  }

  #drawScore(port: PiuPort): void {
    let divisor = 100
    let x = port.width - 34
    const value = this.#score % 1000
    while (divisor >= 1) {
      const digit = Math.floor(value / divisor) % 10
      this.#drawDigit(port, digit, x, 12)
      x += 10
      divisor = Math.floor(divisor / 10)
    }
  }

  #drawDigit(port: PiuPort, digit: number, x: number, y: number): void {
    const mask = DIGIT_MASKS[digit]
    let bit = 1 << 14
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (mask & bit) port.fillColor(COLOR_SCORE, x + column * 2, y + row * 2, 2, 2)
        bit >>= 1
      }
    }
  }

  #drawJumpHint(port: PiuPort): void {
    port.fillColor(COLOR_ACCENT, 17, 31, 4, 18)
    port.fillColor(COLOR_ACCENT, 11, 31, 16, 4)
    port.fillColor(COLOR_ACCENT, 14, 27, 10, 4)
    port.fillColor(COLOR_ACCENT, 17, 23, 4, 4)
    port.fillColor(COLOR_ACCENT, 9, 53, 20, 3)
  }

  #drawGameOver(port: PiuPort): void {
    const left = Math.floor((port.width - 112) / 2)
    const top = Math.floor((port.height - 56) / 2)
    port.fillColor(COLOR_OVERLAY, 0, 0, port.width, port.height)
    port.fillColor(COLOR_GROUND, left, top, 112, 56)
    port.fillColor(COLOR_ACCENT, left + 3, top + 3, 106, 3)
    port.fillColor(COLOR_ACCENT, left + 3, top + 50, 106, 3)
    port.fillColor(COLOR_CLOUD, left + 53, top + 13, 6, 19)
    port.fillColor(COLOR_CLOUD, left + 53, top + 36, 6, 6)
    port.fillColor(COLOR_ACCENT, left + 18, top + 25, 18, 4)
    port.fillColor(COLOR_ACCENT, left + 18, top + 25, 4, 14)
    port.fillColor(COLOR_ACCENT, left + 78, top + 25, 18, 4)
    port.fillColor(COLOR_ACCENT, left + 92, top + 15, 4, 14)
  }
}

const sample: MiniAppDefinition = Object.freeze({
  id: 'sample.stackchan-jump',
  title: 'ｽﾀｯｸﾁｬﾝ JUMP',
  icon: 'play',
  create() {
    return new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: background,
      contents: [
        new Port(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          active: true,
          Behavior: StackchanJumpBehavior,
        }),
      ],
    })
  },
})

export default Object.freeze([sample])
