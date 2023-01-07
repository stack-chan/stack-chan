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
  let yaw = 0
  let pitch = 0
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
    yaw = yaw * 0.5 + pose.yaw * 0.5
    pitch = pitch * 0.5 + pose.pitch * 0.5
    robot.setPose(yaw, pitch, 0)

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
  onRobotCreated
}
