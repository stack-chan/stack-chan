import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from 'face-context'

export type EyelidOptions = {
  cx: number
  cy: number
  width: number
  height: number
  side: keyof FaceContext['eyes']
}

type PositionedShape = PiuShape & { left: number; top: number; width: number; height: number; skin?: PiuSkin }

export function createEyelid({ cx, cy, width, height, side }: EyelidOptions): PositionedShape {
  const shape = new Shape(null, {
    left: cx - width / 2,
    top: cy - height / 2,
    width,
    height,
    skin: new Skin({ fill: defaultFaceContext.theme.secondary }),
    Behavior: class extends Behavior {
      w = width
      h = height
      lastOpen = -1
      lastEmotion: FaceContext['emotion'] | null = null
      lastSecondary: string | null = null
      onFaceContext(shape: PositionedShape, face: FaceContext) {
        const eye = face.eyes[side]
        const open = eye.open
        const emotion = face.emotion
        if (open !== this.lastOpen || emotion !== this.lastEmotion) {
          this.lastOpen = open
          this.lastEmotion = emotion
          this.updatePath(shape, open, emotion)
        }
        const secondary = face.theme.secondary
        if (secondary !== this.lastSecondary) {
          this.lastSecondary = secondary
          shape.skin = new Skin({ fill: secondary })
        }
      }
      updatePath(shape: PositionedShape, open: number, emotion: FaceContext['emotion']) {
        const w = this.w
        const h = this.h
        const x = 0
        const y = 0
        const closedH = h * (1 - open)
        const path = new Outline.CanvasPath()
        switch (emotion) {
          case 'ANGRY':
          case 'SAD': {
            let h1 = y + (h + closedH) / 2
            let h2 = y + closedH
            if (side === 'left') {
              ;[h1, h2] = [h2, h1]
            }
            if (emotion === 'SAD') {
              ;[h1, h2] = [h2, h1]
            }
            path.moveTo(x, y)
            path.lineTo(x, h1)
            path.lineTo(x + w, h2)
            path.lineTo(x + w, y)
            path.closePath()
            break
          }
          case 'SLEEPY':
            path.rect(x, y, w, h * 0.5 + closedH * 0.5)
            break
          case 'HAPPY':
            path.rect(x, y, w, closedH * 0.6)
            path.rect(x, y + h * 0.6, w, h * 0.4)
            break
          default:
            path.rect(x, y, w, closedH)
        }
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = undefined
      }
    },
  }) as PositionedShape

  return shape
}
