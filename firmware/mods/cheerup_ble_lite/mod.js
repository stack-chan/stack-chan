import StkServer from 'stk-server'
import Timer from 'timer'
import { speeches } from 'speeches_cheerup'
import { randomBetween } from 'stackchan-util'

const keys = Object.keys(speeches)

async function sayHooray(robot) {
  const key = keys[Math.floor(randomBetween(0, keys.length))]
  await robot.say(key)
}

function onRobotCreated(robot) {
  let pose
  let hooray = false
  let connected = false
  const rotation = {
    y: 0,
    p: 0,
    r: 0,
  }
  new StkServer({
    onConnected: () => {
      trace('connected\n')
      robot.setTorque(true)
      connected = true
    },
    onReceive: (newPose) => {
      pose = newPose
    },
    onDisconnected: () => {
      robot.setTorque(false)
      connected = false
    },
  })
  Timer.repeat(async () => {
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
      0.1 // immediate update
    )

    // emotion
    robot.setEmotion(pose.emotion)

    // hooray on rising edge
    if (!hooray && pose.hooray) {
      sayHooray(robot)
    }
    hooray = pose.hooray
  }, 100)
}

export default {
  onRobotCreated,
}
