import WebSocket from 'WebSocket'
import { emotionFromName } from 'face-state'
import { speeches } from 'speeches_cheerup'
import { randomBetween } from 'stackchan-util'
import Timer from 'timer'

const keys = Object.keys(speeches)

async function sayHooray(robot) {
  const key = keys[Math.floor(randomBetween(0, keys.length))]
  await robot.say(key)
}

function onContextCreated(robot) {
  let pose
  let hooray = false
  let speaking = false
  let connected = false
  const rotation = {
    y: 0,
    p: 0,
    r: 0,
  }
  const ws = new WebSocket('ws://192.168.7.112:8080')
  ws.addEventListener('open', () => {
    trace('connected\n')
    robot.setTorque(true)
    connected = true
  })
  ws.addEventListener('message', (event) => {
    trace('received\n')
    pose = JSON.parse(event.data)
  })
  ws.addEventListener('close', () => {
    trace('disconnected\n')
    robot.setTorque(false)
    connected = false
  })

  Timer.repeat(() => {
    if (pose == null || !connected) {
      return
    }

    // simple low pass filter
    rotation.y = rotation.y * 0.5 + pose.yaw * 0.5
    rotation.p = rotation.p * 0.5 + pose.pitch * 0.5
    robot.setPose(
      {
        rotation,
      },
      0.1,
    )

    // emotion
    const nextEmotion = typeof pose.emotion === 'string' ? emotionFromName(pose.emotion) : pose.emotion
    if (nextEmotion !== undefined) robot.setEmotion(nextEmotion)

    // hooray on rising edge
    if (!hooray && pose.hooray && !speaking) {
      speaking = true
      sayHooray(robot).then(
        () => {
          speaking = false
        },
        (error) => {
          trace(`hooray failed: ${error}\n`)
          speaking = false
        },
      )
    }
    hooray = pose.hooray
  }, 200)
}

export default {
  onContextCreated,
}
