import { speeches } from 'speeches_monologue'
import { randomBetween } from 'stackchan-util'

const keys = speeches.keys()

async function sayMonologue(robot) {
  const idx = Math.floor(randomBetween(0, keys.length))
  const key = keys[idx]
  await robot.say(key)
}

function onRobotCreated(robot) {
  robot.button.a.onChanged = function () {
    if (this.read()) {
      sayMonologue(robot)
    }
  }
}

export default {
  onRobotCreated,
}
