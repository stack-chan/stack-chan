import { Renderer } from 'simple-face'
import { createBalloonDecorator, createBubbleDecorator } from 'decorator'
import parseBMF from 'commodetto/parseBMF'
import Resource from 'Resource'
import Timer from 'timer'
import { hslToRgb } from 'stackchan-util'
const font = parseBMF(new Resource('OpenSans-Regular-24.bf4'))

const param = {
  right: 20,
  top: 10,
  width: 80,
  height: font.height,
  font,
}

const BALLOONS = [
  createBalloonDecorator({
    ...param,
    text: 'happyyyyyyyy',
  }),
  createBalloonDecorator({
    ...param,
    text: 'ANGRY!!',
  }),
  createBalloonDecorator({
    ...param,
    text: 'SAD...',
  }),
  createBalloonDecorator({
    ...param,
    text: 'sleepy.',
  }),
]

const bubble = createBubbleDecorator({
  x: 10,
  y: 20,
  width: 50,
  height: 60,
})

const EMOTIONS = ['HAPPY', 'ANGRY', 'SAD', 'SLEEPY']

export function onRobotCreated(robot) {
  robot.useRenderer(new Renderer())
  robot.setColor('primary', 0x22, 0x22, 0x22)
  robot.setColor('primary', 0xfa, 0xfa, 0xfa)
  let idx = 0
  let d = null
  Timer.repeat(() => {
    if (d != null) {
      robot.renderer.removeDecorator(d)
    }
    d = BALLOONS[idx]
    robot.renderer.addDecorator(d)
    robot.setEmotion(EMOTIONS[idx])
    if (EMOTIONS[idx] === 'SLEEPY') {
      robot.renderer.addDecorator(bubble)
    } else {
      robot.renderer.removeDecorator(bubble)
    }
    idx = (idx + 1) % EMOTIONS.length
  }, 3000)

  let count = 0
  Timer.repeat(() => {
    robot.setColor('secondary', ...hslToRgb(count, 1, 0.3))
    count = (count + 20) % 360
  }, 1000)
}
