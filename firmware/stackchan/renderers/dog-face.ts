import { RendererBase, Layer, type FacePartFactory, type FaceContext } from 'renderer-base'
import { createEyePart, createEyelidPart } from 'simple-face'
import { createBlinkModifier, createBreathModifier, createSaccadeModifier } from './modifier'

export const createEyeblowPart: FacePartFactory<{ cx: number; cy: number; side: keyof FaceContext['eyes'] }> = ({
  cx,
  cy,
  side,
}) => {
  const direction = side === 'left' ? 1 : -1
  return (_tick, path, { eyes, emotion }) => {
    let d = direction
    if (emotion === 'ANGRY') {
      d *= 1.2
    } else if (emotion === 'SAD') {
      d *= -1
    }
    const eye = eyes[side]
    path.ellipse(cx + 8 * direction, cy - 20 - eye.open * 2, 8, 4, (Math.PI / 8) * d, 0, Math.PI * 2)
  }
}

export const createMouthPart: FacePartFactory<{
  cx: number
  cy: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}> =
  ({ cx, cy, minWidth = 50, maxWidth = 60, minHeight = 8, maxHeight = 24 }) =>
  (_tick, path, { mouth }) => {
    const openRatio = mouth.open
    const h = minHeight + (maxHeight - minHeight) * openRatio
    const w = minWidth + (maxWidth - minWidth) * openRatio
    const x = cx - w / 2
    const y = cy - h / 2
    // mouth
    path.moveTo(x, y)
    path.bezierCurveTo(x, y + 20, cx, y + 20, cx, y)
    path.bezierCurveTo(cx, y + 20, x + w, y + 20, x + w, y)

    // nose
    path.moveTo(cx - 8, y - 16)
    path.quadraticCurveTo(cx, y - 18, cx + 8, y - 16)
    path.bezierCurveTo(cx + 6, y - 4, cx - 6, y - 4, cx - 8, y - 16)
    path.closePath()

    if (h > 16) {
      path.moveTo(x + w / 4, y + 16)
      path.bezierCurveTo(x + w / 8, y + h, x + (w * 7) / 8, y + h, x + (w * 3) / 4, y + 16)
    }
    // path.closePath()
  }

// Renderers
export class Renderer extends RendererBase {
  constructor(option) {
    super(option)
    this.filters = [
      createBlinkModifier({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
      createBreathModifier({ duration: 6000 }),
      createSaccadeModifier({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
    ]
    const layer1 = new Layer({ colorName: 'primary' })
    this.layers.push(layer1)
    layer1.addPart(
      'leftEye',
      createEyePart({
        cx: 90,
        cy: 93,
        side: 'left',
        radius: 10,
      })
    )
    layer1.addPart('rightEye', createEyePart({ cx: 230, cy: 96, side: 'right', radius: 10 }))

    const layer2 = new Layer({ colorName: 'secondary' })
    this.layers.push(layer2)
    layer2.addPart(
      'leftEyelid',
      createEyelidPart({
        cx: 90,
        cy: 93,
        side: 'left',
        width: 24,
        height: 24,
      })
    )
    layer2.addPart(
      'rightEyelid',
      createEyelidPart({
        cx: 230,
        cy: 96,
        side: 'right',
        width: 24,
        height: 24,
      })
    )

    const layer3 = new Layer({ colorName: 'primary', type: 'stroke' })
    this.layers.push(layer3)
    layer3.addPart('mouth', createMouthPart({ cx: 160, cy: 120 }))
    layer1.addPart(
      'leftEyeblow',
      createEyeblowPart({
        cx: 90,
        cy: 93,
        side: 'left',
      })
    )
    layer1.addPart(
      'rightEyeblow',
      createEyeblowPart({
        cx: 230,
        cy: 96,
        side: 'right',
      })
    )
  }
}
