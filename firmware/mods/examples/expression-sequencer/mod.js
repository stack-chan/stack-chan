
import Timer from 'timer'

const sequence = [
  { emotion: 'HAPPY', duration: 800 },
  { emotion: 'NEUTRAL', duration: 1200 },
  { emotion: 'SLEEPY', duration: 1600 },
  { emotion: 'NEUTRAL', duration: 600 },
]

export function onContextCreated(robot) {
  let index = 0
  let running = true
  let timerId = null

  function advance() {
    if (!running) return

    const step = sequence[index]

    // TODO: connect this step to the target firmware's
    // documented face-emotion API.
    trace(`[expression-sequencer] ${step.emotion}\n`)

    index = (index + 1) % sequence.length
    timerId = Timer.set(advance, step.duration)
  }

  robot.input.button.a.onEvent = (event) => {
    if (!event.pressed) return

    running = !running

    if (timerId !== null) {
      Timer.clear(timerId)
      timerId = null
    }

    if (running) advance()
  }

  robot.input.button.b.onEvent = (event) => {
    if (!event.pressed) return

    index = (index + 1) % sequence.length

    if (timerId !== null) {
      Timer.clear(timerId)
      timerId = null
    }

    if (running) advance()
  }

  advance()
}
