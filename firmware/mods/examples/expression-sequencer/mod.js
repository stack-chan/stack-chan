import { Emotion } from 'face-state'
import Timer from 'timer'

const sequence = [
  { emotion: Emotion.HAPPY, duration: 800 },
  { emotion: Emotion.NEUTRAL, duration: 1200 },
  { emotion: Emotion.SLEEPY, duration: 1600 },
  { emotion: Emotion.NEUTRAL, duration: 600 },
]

export function onContextCreated(robot) {
  let index = 0
  let running = true
  let timerId = null

  function clearTimer() {
    if (timerId !== null) {
      Timer.clear(timerId)
      timerId = null
    }
  }

  function advance() {
    if (!running) return

    const step = sequence[index]
    robot.face.setEmotion(step.emotion)

    index = (index + 1) % sequence.length
    timerId = Timer.set(advance, step.duration)
  }

  robot.input.button.a.onEvent = (event) => {
    if (!event.pressed) return

    running = !running
    clearTimer()

    if (running) {
      advance()
    }
  }

  robot.input.button.b.onEvent = (event) => {
    if (!event.pressed) return

    clearTimer()

    if (running) {
      advance()
    } else {
      robot.face.setEmotion(sequence[index].emotion)
      index = (index + 1) % sequence.length
    }
  }

  advance()
}
