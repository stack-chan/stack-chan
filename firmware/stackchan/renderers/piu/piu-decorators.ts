import type { Content } from 'piu/MC'
import type { FaceContext } from './piu-renderer-base'

// Base decorator class
export abstract class PiuDecorator extends Container {
  protected faceContext?: Readonly<FaceContext>

  constructor(behaviorData?: unknown, dictionary?: Record<string, unknown>) {
    super(behaviorData, dictionary ?? {})
  }

  onFaceContextChanged(context: Readonly<FaceContext>) {
    this.faceContext = context
    this.updateAppearance()
  }

  protected abstract updateAppearance(): void
}

// Balloon Decorator (simplified version without text for now)
export class PiuBalloonDecorator extends PiuDecorator {
  private balloon: Content

  constructor(
    data: {
      left?: number
      right?: number
      top?: number
      bottom?: number
      width: number
      height: number
    },
    dictionary?: Record<string, unknown>,
  ) {
    super(data, dictionary)

    const { left, right, top, bottom, width, height } = data

    this.balloon = new Content(null, {
      left: left ?? (right != null ? undefined : 0),
      right: right ?? (left != null ? undefined : 0),
      top: top ?? (bottom != null ? undefined : 0),
      bottom: bottom ?? (top != null ? undefined : 0),
      width,
      height,
      skin: new Skin({
        fill: 'white',
        stroke: 'black',
        borders: { left: 2, right: 2, top: 2, bottom: 2 },
      }),
    })

    this.add(this.balloon)
  }

  protected updateAppearance() {
    if (!this.faceContext) return

    // Update balloon appearance based on face context
    const { theme } = this.faceContext
    const primaryColor = `rgb(${theme.primary[0]}, ${theme.primary[1]}, ${theme.primary[2]})`
    const secondaryColor = `rgb(${theme.secondary[0]}, ${theme.secondary[1]}, ${theme.secondary[2]})`

    this.balloon.skin = new Skin({
      fill: primaryColor,
      stroke: secondaryColor,
      borders: { left: 2, right: 2, top: 2, bottom: 2 },
    })
  }
}

// Heart Decorator
export class PiuHeartDecorator extends PiuDecorator {
  private heart: Content
  private animationTime = 0

  constructor(
    data: {
      x: number
      y: number
      width?: number
      height?: number
    },
    dictionary?: Record<string, unknown>,
  ) {
    super(data, dictionary)

    const { x, y, width = 40, height = 40 } = data

    this.heart = new Content(null, {
      left: x,
      top: y,
      width,
      height,
      skin: new Skin({ fill: 'red' }),
    })

    this.add(this.heart)
    this.start()
  }

  onTimeChanged() {
    this.animationTime += 16 // Approximate 60fps
    const scale = Math.abs(Math.sin(this.animationTime / 100)) / 4 + 0.75

    // Simple scale effect by changing size
    const baseWidth = 40
    const baseHeight = 40
    const newWidth = baseWidth * scale
    const newHeight = baseHeight * scale

    this.heart.coordinates = {
      ...this.heart.coordinates,
    }
    this.heart.size = {
      width: newWidth,
      height: newHeight,
    }
  }

  protected updateAppearance() {
    if (!this.faceContext) return

    const { theme } = this.faceContext
    const primaryColor = `rgb(${theme.primary[0]}, ${theme.primary[1]}, ${theme.primary[2]})`

    this.heart.skin = new Skin({ fill: primaryColor })
  }
}

// Sweat Decorator
export class PiuSweatDecorator extends PiuDecorator {
  private sweat: Content
  private animationTime = 0
  private dropY = 0

  constructor(
    data: {
      x: number
      y: number
      width?: number
      height?: number
    },
    dictionary?: Record<string, unknown>,
  ) {
    super(data, dictionary)

    const { x, y, width = 20, height = 30 } = data

    this.sweat = new Content(null, {
      left: x,
      top: y,
      width,
      height,
      skin: new Skin({ fill: 'lightblue' }),
    })

    this.add(this.sweat)
    this.start()
  }

  onTimeChanged() {
    this.animationTime += 16
    this.dropY = (this.dropY + 1) % 50

    this.sweat.coordinates = {
      ...this.sweat.coordinates,
      top: this.sweat.coordinates.top + (this.dropY > 25 ? -1 : 1),
    }
  }

  protected updateAppearance() {
    if (!this.faceContext) return

    const { theme } = this.faceContext
    const primaryColor = `rgb(${theme.primary[0]}, ${theme.primary[1]}, ${theme.primary[2]})`

    this.sweat.skin = new Skin({ fill: primaryColor })
  }
}

// Anger Decorator (simplified lines effect)
export class PiuAngerDecorator extends PiuDecorator {
  private lines: Content[]
  private animationTime = 0

  constructor(
    data: {
      x: number
      y: number
      width?: number
      height?: number
    },
    dictionary?: Record<string, unknown>,
  ) {
    super(data, dictionary)

    const { x, y } = data

    // Create simple lines to represent anger marks
    this.lines = []
    for (let i = 0; i < 4; i++) {
      const line = new Content(null, {
        left: x + i * 8,
        top: y + i * 8,
        width: 20,
        height: 3,
        skin: new Skin({ fill: 'red' }),
      })
      this.lines.push(line)
      this.add(line)
    }

    this.start()
  }

  onTimeChanged() {
    this.animationTime += 16

    // Animate the lines
    this.lines.forEach((line, i) => {
      const offset = Math.sin(this.animationTime / 50 + i) * 2
      line.coordinates = {
        ...line.coordinates,
        left: line.coordinates.left + offset,
      }
    })
  }

  protected updateAppearance() {
    if (!this.faceContext) return

    const { theme } = this.faceContext
    const primaryColor = `rgb(${theme.primary[0]}, ${theme.primary[1]}, ${theme.primary[2]})`

    this.lines.forEach((line) => {
      line.skin = new Skin({ fill: primaryColor })
    })
  }
}
