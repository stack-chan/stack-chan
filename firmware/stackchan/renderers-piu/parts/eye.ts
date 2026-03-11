import type { Container as PiuContainer } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from 'face-context'

export type EyeOptions = {
  cx: number
  cy: number
  radius?: number
  side: keyof FaceContext['eyes']
}

type MovableShape = PiuShape & { left: number; top: number }

export function createEye({ cx, cy, radius = 8, side }: EyeOptions): PiuContainer {
  const diameter = radius * 2
  const iris = new Shape(null, { left: 2, top: 2, width: diameter, height: diameter }) as MovableShape
  const path = new Outline.CanvasPath()
  path.arc(radius, radius, radius, 0, 2 * Math.PI)
  path.closePath()
  iris.fillOutline = Outline.fill(path)
  iris.strokeOutline = undefined

  iris.skin = new Skin({ fill: defaultFaceContext.theme.primary })

  const EyeContainer = new Container(null, {
    left: cx - radius - 2,
    top: cy - radius - 2,
    width: diameter + 4,
    height: diameter + 4,
    contents: [iris],
    Behavior: class extends Behavior {
      baseOffset: number
      lastGazeX: number
      lastGazeY: number
      lastPrimary: string | null
      constructor() {
        super()
        this.baseOffset = 2
        this.lastGazeX = 0
        this.lastGazeY = 0
        this.lastPrimary = null
      }
      onFaceContext(_container: PiuContainer, face: FaceContext) {
        const eye = face.eyes[side]
        const gx = eye.gazeX ?? 0
        const gy = eye.gazeY ?? 0
        if (gx !== this.lastGazeX) {
          this.lastGazeX = gx
          iris.coordinates = {
            ...(iris.coordinates ?? {}),
            left: this.baseOffset + gx * 2,
            top: iris.coordinates?.top ?? iris.top,
          }
        }
        if (gy !== this.lastGazeY) {
          this.lastGazeY = gy
          iris.coordinates = {
            ...(iris.coordinates ?? {}),
            left: iris.coordinates?.left ?? iris.left,
            top: this.baseOffset + gy * 2,
          }
        }
        const primary = face.theme.primary
        if (primary !== this.lastPrimary) {
          this.lastPrimary = primary
          iris.skin = new Skin({ fill: primary })
        }
      }
    },
  }) as PiuContainer

  return EyeContainer
}
