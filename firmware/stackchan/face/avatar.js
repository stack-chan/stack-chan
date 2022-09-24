import Poco from 'commodetto/Poco'
import { Outline } from 'commodetto/outline'
import Timer from 'timer'
import deepEqual from 'deepEqual'

/* global screen */

let poco = new Poco(screen, { rotation: 90 })
let background = poco.makeColor(0, 0, 0)
let foreground = poco.makeColor(0, 255, 0)
let INTERVAL = 1000 / 15

const Emotion = {
  NEUTRAL: 'NEUTRAL',
}

function randomBetween(min, max) {
  return min + (max - min) * Math.random()
}

function quantize(value, divider) {
  return Math.ceil(value * divider) / divider
}

const useBlink = (openMin, openMax, closeMin, closeMax) => {
  let isBlinking = false
  let nextToggle = randomBetween(openMin, openMax)
  let count = 0
  return (tickMillis) => {
    let eyeOpen = isBlinking ? quantize(1 - Math.sin((count / nextToggle) * Math.PI), 8) : 1
    count += tickMillis
    if (count >= nextToggle) {
      isBlinking = !isBlinking
      count = 0
      nextToggle = isBlinking ? randomBetween(closeMin, closeMax) : randomBetween(openMin, openMax)
    }
    return eyeOpen
  }
}

const useSaccade = (updateMin, updateMax, gain) => {
  let nextToggle = randomBetween(updateMin, updateMax)
  let saccadeX = 0
  let saccadeY = 0
  return (tickMillis) => {
    nextToggle -= tickMillis
    if (nextToggle < 0) {
      saccadeX = (Math.random() * 2 - 1) * gain
      saccadeY = (Math.random() * 2 - 1) * gain
      nextToggle = randomBetween(updateMin, updateMax)
    }
    return [saccadeX, saccadeY]
  }
}

const useBreath = (duration) => {
  let time = 0
  return (tickMillis, emotion = Emotion.NEUTRAL) => {
    time += tickMillis % duration
    return quantize(Math.sin((2 * Math.PI * time) / duration), 8)
  }
}

const useDrawEyelid = (cx, cy, width, height) => (path, eyeContext) => {
  let w = width
  let h = height * (1 - eyeContext.open)
  let x = cx - width / 2
  let y = cy - height / 2
  path.rect(x, y, w, h)
}

const useDrawEye =
  (cx, cy, radius = 8) =>
  (path, eyeContext) => {
    let openRatio = eyeContext.open
    let offsetX = (eyeContext.gazeX ?? 0) * 2
    let offsetY = (eyeContext.gazeY ?? 0) * 2
    if (openRatio < 0.3) {
      // closed
      let w = radius * 2
      let h = Math.min(4, radius / 2)
      let x = cx - w / 2
      let y = cy - h / 2
      path.rect(x, y, w, h)
    } else {
      // open
      path.arc(cx + offsetX, cy + offsetY, radius, 0, 2 * Math.PI)
    }
  }

const useDrawMouth =
  (cx, cy, minWidth = 50, maxWidth = 90, minHeight = 8, maxHeight = 58) =>
  (path, mouthContext) => {
    let openRatio = mouthContext.open
    let h = minHeight + (maxHeight - minHeight) * openRatio
    let w = minWidth + (maxWidth - minWidth) * (1 - openRatio)
    let x = cx - w / 2
    let y = cy - h / 2
    path.rect(x, y, w, h)
  }

class Renderer {
  constructor() {
    this.drawLeftEye = useDrawEye(90, 93, 8)
    this.drawLeftEyelid = useDrawEyelid(90, 93, 24, 24)
    this.drawRightEye = useDrawEye(230, 96, 8)
    this.drawRightEyelid = useDrawEyelid(230, 96, 24, 24)
    this.drawMouth = useDrawMouth(160, 148)

    this.updateBlink = useBlink(400, 5000, 200, 400)
    this.updateBreath = useBreath(6000)
    // this.updateBreath = () => 0
    this.updateSaccade = useSaccade(300, 2000, 1.0)
    this.tick = 0
    this.outline = null
    this.lastContext = null
  }
  update(poco) {
    let eyeOpen = this.updateBlink(INTERVAL)
    let breath = this.updateBreath(INTERVAL)
    let [saccadeX, saccadeY] = this.updateSaccade(INTERVAL)
    this.tick = (this.tick + INTERVAL) % 1000
    const faceContext = {
      mouth: {
        open: 0,
      },
      eyes: {
        left: {
          open: eyeOpen,
          gazeX: saccadeX,
          gazeY: saccadeY,
        },
        right: {
          open: eyeOpen,
          gazeX: saccadeX,
          gazeY: saccadeY,
        },
      },
      breath,
      emotion: Emotion.NEUTRAL,
      theme: {
        primary: 'white',
        secondary: 'black',
      },
    }
    if (deepEqual(this.lastContext, faceContext)) {
      return
    }
    this.render(poco, faceContext)
    this.lastContext = faceContext
  }
  render(poco, faceContext) {
    poco.begin(40, 80, poco.width - 80, poco.height - 80)
    poco.fillRectangle(background, 0, 0, poco.width, poco.height)
    let layer1 = new Outline.CanvasPath()

    this.drawLeftEye(layer1, faceContext.eyes.left)
    this.drawRightEye(layer1, faceContext.eyes.right)
    this.drawMouth(layer1, faceContext.mouth)
    let outline = Outline.fill(layer1).translate(0, faceContext.breath * 3 ?? 0)
    poco.blendOutline(foreground, 255, outline, 0, 0)

    let layer2 = new Outline.CanvasPath()
    this.drawLeftEyelid(layer2, faceContext.eyes.left)
    this.drawRightEyelid(layer2, faceContext.eyes.right)
    outline = Outline.fill(layer2, Outline.EVEN_ODD_RULE).translate(0, faceContext.breath * 3 ?? 0)
    poco.blendOutline(background, 255, outline, 0, 0)
    poco.end()
  }
}

let avatar = new Renderer()
poco.begin()
poco.fillRectangle(background, 0, 0, poco.width, poco.height)
poco.end()
Timer.repeat(() => {
  avatar.update(poco)
}, INTERVAL)
