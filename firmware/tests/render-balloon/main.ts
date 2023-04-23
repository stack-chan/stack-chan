import { defaultFaceContext, Renderer, type FaceContext } from 'dog-face-renderer'
import Poco from 'commodetto/Poco'
import Timer from 'timer'
import Resource from 'Resource'
import parseBMF from 'commodetto/parseBMF'
import { Outline, RoundRectPath } from 'commodetto/outline'
import structuredClone from 'structuredClone'

const font = parseBMF(new Resource('NotoSansJP-Regular-24.bf4'))
const INTERVAL = 1000 / 30
let poco = new Poco(screen, { rotation: 90, displayListLength: 1024 })
const renderer = new Renderer({ poco })
const white = poco.makeColor(255, 255, 255)
const black = poco.makeColor(0, 0, 0)
let w = 120
let faceContext
let count = 0
let path = new Outline.CanvasPath()
path.moveTo(5, 5)
path.lineTo(15, 20)
path.lineTo(20, 15)
path.closePath()

type RenderBalloonProps = {
  top?: number
  left?: number
  bottom?: number
  right?: number
  width: number
  height: number
  font: ReturnType<typeof parseBMF>
  text: string
}
const useRenderBalloon = ({ left, top, bottom, right, width, height, font, text }: RenderBalloonProps) => {
  const x = left ?? (right != null ? poco.width - right - width : (poco.width - width) / 2)
  const y = top ?? (bottom != null ? poco.height - bottom - height : (poco.height - height) / 2)
  const outline = Outline.fill(Outline.RoundRectPath(0, 0, width, height, 6))
  let textWidth = poco.getTextWidth(text, font)
  let textX = 0
  let space = 20
  trace(`${x}, ${y}, ${width}, ${height}\n`)
  return (poco) => {
    poco.clip(x, y, width, height)
    poco.fillRectangle(black, x, y, width, height)
    poco.blendOutline(white, 255, outline, x, y)
    poco.drawText(text, font, black, x - textX, y)
    if (textWidth + space >= textX) {
      poco.drawText(text, font, black, x - textX + textWidth + space, y)
    }
    poco.clip()
    textX = textX >= textWidth + space ? 2 : textX + 2
  }
}

const renderBalloon = useRenderBalloon({
  left: 10,
  top: 10,
  width: 100,
  height: font.height,
  font,
  text: 'こんにちはせかい',
})
const renderBalloon2 = useRenderBalloon({
  right: 40,
  bottom: 10,
  width: 120,
  height: font.height,
  font,
  text: 'じゅげむじゅげむごこうのすりきれかいじゃりすいぎょのすいぎょうまつふうらいまつ',
})

renderer.addEffect(renderBalloon2)
Timer.repeat(() => {
  count = (count + 30) % 360
  faceContext = structuredClone(defaultFaceContext)
  faceContext.mouth.open = Math.sin((Math.PI * 2 * count) / 360) / 2 + 0.5

  renderer.update(INTERVAL, faceContext)
}, INTERVAL)
