import parseBMF from 'commodetto/parseBMF'
import { type FaceEffectFactory } from 'renderer'
import { Outline } from 'commodetto/outline'

export const useRenderBalloon: FaceEffectFactory<
  {
    left: number
    top: number
    bottom: number
    right: number
    width: number
    height: number
    font: ReturnType<typeof parseBMF>
    text: string
  },
  boolean
> = ({ left, top, bottom, right, width, height, font, text }) => {
  const outline = Outline.fill(Outline.RoundRectPath(0, 0, width, height, 6))
  let textX = 0
  let space = 20
  return (tick, poco, face, end = false) => {
    const x = left ?? (right != null ? poco.width - right - width : (poco.width - width) / 2)
    const y = top ?? (bottom != null ? poco.height - bottom - height : (poco.height - height) / 2)
    const textWidth = poco.getTextWidth(text, font)
    const bg = poco.makeColor(...face.theme.secondary)
    const white = poco.makeColor(0xff, 0xff, 0xff)
    const black = poco.makeColor(0x00, 0x00, 0x00)
    poco.begin(x, y, width, height)
    poco.fillRectangle(bg, 0, 0, poco.width, poco.height)
    if (end) {
      poco.end()
      return
    }
    poco.blendOutline(white, 255, outline, x, y)
    poco.drawText(text, font, black, x - textX, y)
    if (textWidth > width) {
      if (textWidth + space >= Math.floor(textX)) {
        poco.drawText(text, font, black, x - textX + textWidth + space, y)
      }
      textX = textX >= textWidth + space ? 2 : textX + tick / 30
    }
    poco.end()
  }
}
