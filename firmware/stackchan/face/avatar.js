import { Outline } from 'commodetto/outline'
import { Behavior } from 'piu/MC'

const useBlink = (openMin, openMax, closeMin, closeMax) => {
  let eyeOpen = 1
  let nextToggle = randomBetween(openMin, openMax)
  return (tickMillis) => {
    nextToggle -= tickMillis
    if (nextToggle < 0) {
      eyeOpen = Number(!eyeOpen)
      nextToggle = randomBetween(eyeOpen ? openMin : closeMin, eyeOpen ? openMax : closeMax)
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
    return Math.sin((2 * Math.PI * time) / duration)
  }
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
  (cx, cy, minWidth = 50, maxWidth = 90, minHeight = 4, maxHeight = 60) =>
  (path, mouthContext) => {
    let openRatio = mouthContext.open
    let h = minHeight + (maxHeight - minHeight) * openRatio
    let w = minWidth + (maxWidth - minWidth) * (1 - openRatio)
    let x = cx - w / 2
    let y = cy - h / 2
    path.rect(x, y, w, h)
  }

const Emotion = {
  NEUTRAL: 'NEUTRAL',
}

function randomBetween(min, max) {
  return min + (max - min) * Math.random()
}

export default class extends Behavior {
  drawFace(faceContext) {
    let fillPath = new Outline.CanvasPath()
    let strokePath = new Outline.CanvasPath()

    this.drawLeftEye(fillPath, faceContext.eyes.left)
    this.drawRightEye(fillPath, faceContext.eyes.right)
    this.drawMouth(fillPath, faceContext.mouth)

    return [fillPath, strokePath]
  }

  onCreate(shape) {
    shape.duration = 6000
    shape.interval = 125
    this.eyeOpen = 1
    this.cx = application.width >> 1
    this.cy = application.height >> 1
    this.drawLeftEye = useDrawEye(90, 93, 8)
    this.drawRightEye = useDrawEye(230, 96, 8)
    this.drawMouth = useDrawMouth(160, 148)
    this.updateBlink = useBlink(400, 5000, 100, 400)
    this.updateBreath = useBreath(6000)
    this.updateSaccade = useSaccade(300, 2000, 1.0)
  }
  onFinished(shape) {
    shape.time = 0
    shape.start()
  }
  onTimeChanged(shape) {
    let f = shape.fraction * 4
    f = f * 2 * Math.PI
    const gain = Math.abs(Math.cos(f))
    const gain2 = Math.sin(f)
    let eyeOpen = this.updateBlink(shape.interval)
    let breath = this.updateBreath(shape.interval)
    let [saccadeX, saccadeY] = this.updateSaccade(shape.interval)
    const faceContext = {
      mouth: {
        // open: gain,
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
    const [fillPath, strokePath] = this.drawFace(faceContext)
    shape.bubble('onLabel', `avatar face`)
    shape.fillOutline = Outline.fill(fillPath).translate(0, faceContext.breath * 3 ?? 0)
    // .translate(gain2 * -8, gain * 4)
    // .rotate(gain2 * Math.PI / 16, this.cx, this.cy);
  }
}
