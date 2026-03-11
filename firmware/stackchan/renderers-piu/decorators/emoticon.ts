import { Outline } from 'commodetto/outline'
import type { Container as PiuContainer, Content as PiuContent, Skin as PiuSkin } from 'piu/MC'
import { toColorString, type FaceContext } from 'face-context'
import type { FaceDecorator } from 'renderer-simple'

type EmoticonKey = 'heart' | 'angry' | 'sweat' | 'pale'

type EmoticonNode = PiuContent & { skin?: PiuSkin; fillOutline?: unknown; strokeOutline?: unknown }

function createEmoticonShape(key: EmoticonKey, color: string): EmoticonNode {
  const size = 40
  const shape = new Shape(null, {
    left: 0,
    top: 0,
    width: size,
    height: size,
    skin: new Skin({ fill: color, stroke: color }),
  }) as EmoticonNode

  const path = new Outline.CanvasPath()
  switch (key) {
    case 'heart':
      path.moveTo(20, 13)
      path.bezierCurveTo(18, 8, 14, 5, 10, 5)
      path.bezierCurveTo(8, 5, 0, 5, 0, 15)
      path.bezierCurveTo(0, 30, 18, 35, 20, 40)
      path.bezierCurveTo(22, 35, 40, 30, 40, 15)
      path.bezierCurveTo(40, 5, 32, 5, 30, 5)
      path.bezierCurveTo(26, 5, 22, 8, 20, 13)
      shape.fillOutline = Outline.fill(path)
      shape.strokeOutline = undefined
      break
    case 'angry':
      path.moveTo(10, 10)
      path.lineTo(18, 14)
      path.moveTo(30, 10)
      path.lineTo(22, 14)
      path.moveTo(12, 26)
      path.quadraticCurveTo(20, 22, 28, 26)
      shape.strokeOutline = Outline.stroke(path, 2)
      shape.fillOutline = undefined
      break
    case 'sweat':
      path.moveTo(20, 30)
      path.bezierCurveTo(30, 30, 30, 15, 20, 0)
      path.bezierCurveTo(10, 15, 10, 30, 20, 30)
      shape.fillOutline = Outline.fill(path)
      shape.strokeOutline = undefined
      break
    case 'pale':
      path.moveTo(12, 8)
      path.lineTo(12, 28)
      path.moveTo(20, 8)
      path.lineTo(20, 22)
      path.moveTo(28, 8)
      path.lineTo(28, 28)
      shape.strokeOutline = Outline.stroke(path, 2)
      shape.fillOutline = undefined
      break
  }
  return shape
}

export function createEmoticonDecorator(
  key: EmoticonKey,
  opts: { x?: number; y?: number } = {},
): FaceDecorator & { build: (container: PiuContainer) => PiuContent } {
  let node: EmoticonNode | null = null
  let phase = 0
  const { x = 4, y = 4 } = opts

  const decorator: FaceDecorator & { build: (container: PiuContainer) => PiuContent } = (tick, face, end) => {
    if (!node) return
    const primary = toColorString(face.theme.primary)
    if (node.skin?.fill !== primary || node.skin?.stroke !== primary) {
      node.skin = new Skin({ fill: primary, stroke: primary })
    }
    if (end) {
      node.visible = false
      return
    }
    node.visible = true
    phase = (phase + tick) % 1000
    // simple pulse animation for heart, slight wobble for others
    const scale =
      key === 'heart' ? 0.9 + 0.1 * Math.abs(Math.sin((phase / 1000) * 2 * Math.PI)) : 1 + 0.02 * Math.sin(phase / 1000)
    node.coordinates = {
      left: x,
      top: y,
    }
  }

  decorator.build = () => {
    node = createEmoticonShape(key, '#ffffff')
    node.coordinates = { left: x, top: y }
    return node
  }

  return decorator
}
