import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from 'face-context'
import type { FaceSkinPalette } from 'face-skin'
import type { Container as PiuContainer, Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type EyeOptions = {
  cx: number
  cy: number
  radius?: number
  side: keyof FaceContext['eyes']
  eyelidWidth?: number
  eyelidHeight?: number
}

type IrisOptions = {
  radius: number
  left: number
  top: number
}

export type EyelidOptions = {
  cx: number
  cy: number
  width: number
  height: number
  side: keyof FaceContext['eyes']
}

type PositionedShape = Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & {
  left: number
  top: number
  width: number
  height: number
  skin?: PiuSkin
  state?: number
  fillOutline?: Outline
  strokeOutline?: Outline
}
type PositionedContent = PiuShape & {
  coordinates?: { left?: number; top?: number; width?: number; height?: number }
}

export const Eyelid = defineShapeTemplate((opts: EyelidOptions) => {
  const width = opts.width
  const height = opts.height
  const side = opts.side
  return {
    left: opts.cx - width / 2,
    top: opts.cy - height / 2,
    width,
    height,
    skin: new Skin({ fill: defaultFaceContext.theme.secondary }),
    Behavior: class extends Behavior {
      lastOpen = -1
      lastEmotion: FaceContext['emotion'] | null = null
      palette: FaceSkinPalette | null = null
      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.palette = palette
        shape.skin = palette.palette
        shape.state = palette.secondaryState
      }
      onFaceContext(shape: PositionedShape, face: FaceContext) {
        const eye = face.eyes[side]
        const open = eye.open
        const emotion = face.emotion
        if (open !== this.lastOpen || emotion !== this.lastEmotion) {
          this.lastOpen = open
          this.lastEmotion = emotion
          this.updatePath(shape, open, emotion)
        }
      }
      updatePath(shape: PositionedShape, open: number, emotion: FaceContext['emotion']) {
        const w = width
        const h = height
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
  }
})

const Iris = defineShapeTemplate((opts: IrisOptions) => {
  const radius = opts.radius
  const diameter = radius * 2
  return {
    left: opts.left,
    top: opts.top,
    width: diameter,
    height: diameter,
    skin: new Skin({ fill: defaultFaceContext.theme.primary }),
    Behavior: class extends Behavior {
      palette: FaceSkinPalette | null = null
      onCreate(shape: PositionedShape, _data: object, _context: unknown) {
        const path = new Outline.CanvasPath()
        path.arc(radius, radius, radius, 0, 2 * Math.PI)
        path.closePath()
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = undefined
      }
      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.palette = palette
        shape.skin = palette.palette
        shape.state = palette.primaryState
      }
      onFaceContext(shape: PositionedShape, face: FaceContext) {
        if (this.palette) return
        const primary = face.theme.primary
        shape.skin = new Skin({ fill: primary })
      }
    },
  }
})

export const Eye = Container.template((opts: EyeOptions) => {
  const radius = opts.radius ?? 8
  const diameter = radius * 2
  const eyelidWidth = opts.eyelidWidth ?? radius * 3
  const eyelidHeight = opts.eyelidHeight ?? radius * 3
  const width = Math.max(diameter, eyelidWidth)
  const height = Math.max(diameter, eyelidHeight)
  const irisBaseLeft = (width - diameter) / 2
  const irisBaseTop = (height - diameter) / 2
  const irisBaseCoordinates = { left: irisBaseLeft, top: irisBaseTop, width: diameter, height: diameter }
  const eyelid = new Eyelid({
    cx: width / 2,
    cy: height / 2,
    width: eyelidWidth,
    height: eyelidHeight,
    side: opts.side,
  })
  const iris = new Iris({ radius, left: irisBaseLeft, top: irisBaseTop }) as PositionedContent
  return {
    clip: true,
    left: opts.cx - width / 2,
    top: opts.cy - height / 2,
    width,
    height,
    // skin: new Skin({ fill: '#0000ff' }),
    Behavior: class extends Behavior {
      lastGazeX = NaN
      lastGazeY = NaN
      onFaceContext(_container: PiuContainer, face: FaceContext) {
        const eye = face.eyes[opts.side]
        const offsetX = (eye.gazeX ?? 0) * 2
        const offsetY = (eye.gazeY ?? 0) * 2
        if (offsetX === this.lastGazeX && offsetY === this.lastGazeY) return
        this.lastGazeX = offsetX
        this.lastGazeY = offsetY
        iris.coordinates = {
          ...irisBaseCoordinates,
          left: irisBaseLeft + offsetX,
          top: irisBaseTop + offsetY,
        }
      }
    },
    contents: [
      // new Content(null, {
      //   left: 0,
      //   top: 0,
      //   width,
      //   height,
      //   skin: new Skin({ fill: '#00ff00' }),
      // }),
      iris,
      eyelid,
    ],
  }
})
