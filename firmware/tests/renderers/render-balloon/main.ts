import { Renderer } from 'dog-face'
import { defaultFaceContext } from 'renderer-base'
import { createBalloonDecorator } from 'decorator'
import Poco from 'commodetto/Poco'
import Timer from 'timer'
import Resource from 'Resource'
import parseBMF from 'commodetto/parseBMF'
import structuredClone from 'structuredClone'

const font = parseBMF(new Resource('NotoSansJP-Regular-24.bf4'))
let poco = new Poco(screen, { rotation: 90, displayListLength: 1024 })
const renderer = new Renderer({ poco })
type Color = [number, number, number]
const black: Color = [0, 0, 0]
const brown: Color = [255, 146, 0]

const balloon = createBalloonDecorator({
  bottom: 5,
  right: 10,
  width: 120,
  height: font.height,
  font,
  text: 'じゅげむじゅげむごこうのすりきれかいじゃりすいぎょのすいぎょうまつふうらいまつ...'
})
renderer.addDecorator(balloon)

const INTERVAL = 1000 / 30
const context = structuredClone(defaultFaceContext)
context.theme.primary = black
context.theme.secondary = brown
let count = 0
Timer.repeat(() => {
  count = (count + 30) % 360
  context.mouth.open = Math.sin((Math.PI * 2 * count) / 360) / 2 + 0.5

  renderer.update(INTERVAL, context)
}, INTERVAL)
