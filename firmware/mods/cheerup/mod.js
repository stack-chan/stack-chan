import Avatar, { AvatarMouth } from 'avatar'
import initNetwork from 'init-network'
import ttsResources from 'speeches'
import { Client } from 'websocket'

const wsHost = 'localhost'
const wsPort = 8080

const speeches = ttsResources.speeches
const texts = Object.values(speeches)

let ap
let robot
let rightEye, leftEye, mouth
let leftOpen = true
let rightOpen = true
let hooray = false

function getSpeechText() {
  const len = texts.length
  const rand = Math.random()
  const idx = Math.floor(rand * len)
  return texts[idx]
}

function renderSpeech(str) {
  const avatar = ap.content('avatar')
  avatar && avatar.delegate('startSpeech')
}

function removeSpeech() {
  const avatar = ap.content('avatar')
  avatar && avatar.delegate('stopSpeech')
}

async function speak(str) {
  if (robot == null) {
    trace('robot not initialized\n')
    return
  }
  renderSpeech(str)
  await robot.speak(str).catch(() => {
    trace('thrown\n')
  })
  removeSpeech()
}

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

function getEyeVariant(ratio, currentOpen) {
  const thresh = currentOpen ? 0.3 : 0.6
  return ratio > thresh ? 0 : 2
}
function getMouthVariant(ratio) {
  const i = Math.min(ratio * 6, 5)
  return i
}

function createAvatar(primaryColor, secondaryColor) {
  const avatar = new Avatar({
    width: 320,
    height: 240,
    name: 'avatar',
    primaryColor,
    secondaryColor,
    props: {
      autoUpdateGaze: false,
      autoUpdateBlink: false,
      autoUpdateBreath: true,
    },
  })
  const mouth = new AvatarMouth({
    left: 120,
    top: 128,
    name: 'mouth',
    color: 'white',
    skin: new AvatarMouthSkin(),
  })
  mouth.state = 1
  avatar.replace(avatar.content('mouth'), mouth)
  return avatar
}

function onLaunch() {
  ap = new Application(null, {
    displayListLength: 4096,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    skin: new Skin({ fill: 'white' }),
    contents: [createAvatar('white', 'black')],
  })
  const avatar = ap.content('avatar')
  leftEye = avatar.content('leftEye').content('eyelid')
  rightEye = avatar.content('rightEye').content('eyelid')
  mouth = avatar.content('mouth')
  return ap
}

function onRobotCreated(r) {
  robot = r
  initNetwork(() => {
    new Client({ host: wsHost, port: wsPort /* path */ }).callback = function (message, value) {
      switch (message) {
        case Client.connect:
          trace('socket connect\n')
          break

        case Client.handshake:
          r._driver._pan.setTorqueMode(1)
          r._driver._tilt.setTorqueMode(1)
          trace('websocket handshake success\n')
          break

        case Client.receive:
          trace('received\n')
          const pose = JSON.parse(value)
          const panAngle = (pose.yaw * 180) / Math.PI
          const tiltAngle = (-pose.pitch * 180) / Math.PI
          r._driver._pan.setAngle(panAngle)
          r._driver._tilt.setAngle(tiltAngle)
          if (pose.hooray != null) {
            if (hooray === false && pose.hooray === true) {
              speak(getSpeechText())
            }
            hooray = pose.hooray
          }
          const leftEyeVariant = getEyeVariant(pose.leftEyeOpen, leftOpen)
          leftOpen = leftEyeVariant === 0
          const rightEyeVariant = getEyeVariant(pose.rightEyeOpen, rightOpen)
          rightOpen = rightEyeVariant === 0
          const mouthVariant = getMouthVariant(pose.mouthOpen)

          leftEye.variant = leftEyeVariant
          rightEye.variant = rightEyeVariant
          mouth.variant = mouthVariant
          mouth.state = pose.emotion === 'HAPPY' ? 1 : 0
          break

        case Client.disconnect:
          trace('websocket close\n')
          r._driver._pan.setTorqueMode(0)
          r._driver._tilt.setTorqueMode(0)
          break
      }
    }
  })
}
export default {
  onLaunch,
  onRobotCreated,
  autoLoop: false,
}
