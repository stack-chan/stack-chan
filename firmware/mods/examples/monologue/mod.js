import config from 'mc/config'
import { speeches } from 'speeches_monologue'
import { randomBetween } from 'stackchan-util'

const keys = Object.keys(speeches)

async function sayMonologue(robot) {
  const idx = Math.floor(randomBetween(0, keys.length))
  const key = keys[idx]
  await robot.audio.say(config.tts.type === 'local' ? key : speeches[key])
}

function onContextCreated(robot) {
  robot.input.button.a.onEvent = (event) => {
    if (event.pressed) {
      sayMonologue(robot)
    }
  }
}

export default {
  onContextCreated,
}
