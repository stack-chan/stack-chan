import { Emoticon } from 'effects/emoticon'
import { SpeechBalloon } from 'effects/speech-balloon'
import { Emotion } from 'face-state'
import { hslToRgb } from 'stackchan-util'
import Timer from 'timer'

const param = {
  right: 20,
  top: 10,
  width: 120,
  font: 'k8x12-12',
}

const BALLOONS = [
  new SpeechBalloon({
    ...param,
    text: 'happyyyyyyyy',
  }),
  new SpeechBalloon({
    ...param,
    text: 'ANGRY!!',
  }),
  new SpeechBalloon({
    ...param,
    text: 'SAD...',
  }),
  new SpeechBalloon({
    ...param,
    text: 'sleepy.',
  }),
]

const sleepy = new Emoticon({ key: 'sleepy', left: 10, top: 20, width: 50, height: 60 })

const EMOTIONS = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.SLEEPY]

export function onRobotCreated(robot) {
  robot.setColor('primary', 0x22, 0x22, 0x22)
  robot.setColor('primary', 0xfa, 0xfa, 0xfa)
  let idx = 0
  let d = null
  Timer.repeat(() => {
    if (d != null) {
      robot.ui.removeEffect(d)
    }
    d = BALLOONS[idx]
    robot.ui.addEffect(d)
    robot.setEmotion(EMOTIONS[idx])
    if (EMOTIONS[idx] === Emotion.SLEEPY) {
      robot.ui.addEffect(sleepy)
    } else {
      robot.ui.removeEffect(sleepy)
    }
    idx = (idx + 1) % EMOTIONS.length
  }, 3000)

  let count = 0
  Timer.repeat(() => {
    robot.setColor('secondary', ...hslToRgb(count, 1, 0.3))
    count = (count + 20) % 360
  }, 1000)
}
