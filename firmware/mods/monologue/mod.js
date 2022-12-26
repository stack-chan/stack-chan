import Timer from 'timer'
import { speeches } from 'speeches_monologue'
import { randomBetween } from 'stackchan-util'

let robot
const keys = speeches.keys()

async function sayMonologue() {
  const idx = Math.floor(randomBetween(0, keys.length))
  const key = keys[idx]
  await robot.say(key)
  const next = randomBetween(60, 30 * 60) * 1000 // ms
  // Timer.set(sayMonologue, next)
}

function onRobotCreated(r) {
  robot = r
  // sayMonologue()
}

async function onButtonPressed(button, pressed) {
  if (button === 'A' && pressed) {
    await sayMonologue()
  }
}

export default {
  onRobotCreated,
  onButtonPressed
}
