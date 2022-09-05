/* global screen */

import { AvatarMouth } from 'avatar'
import StkServer from 'stk-server'
import Timer from 'timer'
import ttsResources from 'speeches'

let stkServer
let pose
let ap
let mouth
let robot
let hooray = false
let saying = false
let connected = false
let panAngle = 90
let tiltAngle = 90
const speeches = ttsResources.speeches
const texts = Object.values(speeches)

const AvatarMouthSkinTexture = Texture.template({
  path: 'mouth_smile-alpha.bmp',
})

const AvatarMouthSkin = Skin.template({
  Texture: AvatarMouthSkinTexture,
  width: 80,
  height: 40,
  variants: 80,
  states: 40,
  color: 'white',
})

async function sayHooray() {
  if (saying) {
    return
  }
  saying = true
  const text = texts[Math.floor(Math.random() * texts.length)]
  const avatar = ap.content('avatar')
  avatar.delegate('startSpeech')
  await robot?.speak(text).catch(() => {
    trace('something wrong\n')
  })
  avatar.delegate('stopSpeech')
  saying = false
}

function onApplicationCreated(newApp) {
  mouth = new AvatarMouth({
    left: 120,
    top: 128,
    name: 'mouth',
    color: 'white',
    skin: new AvatarMouthSkin(),
  })
  ap = newApp
  const avatar = ap.content('avatar')
  avatar.replace(avatar.content('mouth'), mouth)
}

function onRobotCreated(newRobot) {
  robot = newRobot
  stkServer = new StkServer({
    onConnected: () => {
      trace('connected\n')
      connected = true
    },
    onReceive: (newPose) => {
      pose = newPose
    },
    onDisconnected: () => {
      connected = false
      robot?._driver._pan.setTorque(false)
      robot?._driver._pan.setTorque(false)
    },
  })
  Timer.repeat(async () => {
    if (pose == null || !connected) {
      return
    }
    trace(`applying: ${pose}\n`)
    const newPanAngle = 90 - (pose.yaw * 180) / Math.PI
    const newTiltAngle = 90 - Math.min(Math.max((pose.pitch * 180) / Math.PI, -25), 10)
    panAngle = 0.8 * panAngle + 0.2 * newPanAngle
    tiltAngle = 0.8 * tiltAngle + 0.2 * newTiltAngle
    await robot?._driver._pan.setAngle(panAngle)
    await robot?._driver._tilt.setAngle(tiltAngle)

    mouth.state = pose.emotion === 'HAPPY' ? 1 : 0
    if (!hooray && pose.hooray) {
      sayHooray()
    }
    hooray = pose.hooray
  }, 33)
}

export default {
  onRobotCreated,
  onApplicationCreated,
}
