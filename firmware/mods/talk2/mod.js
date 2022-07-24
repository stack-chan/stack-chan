/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import Avatar, { Emotion, AvatarMouth } from 'avatar'
import MarqueeLabel from 'marquee-label'
import Emoticon from 'emoticon'
import { Application, Skin } from 'piu/MC'
import ttsResources from 'speeches'
import Timer from 'timer'
const speeches = ttsResources.speeches
/* global trace, SharedArrayBuffer */

let robot
let ap
let mouth
let emoticon
let Digital

const fluid = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

async function applyPoseAsync(robot, pose) {
  return new Promise((resolve, reject) => {
    robot._driver.applyPose(pose, 0.5)
    Timer.set(resolve, 600)
  })
}

function createHeartEmoticon() {
  return new Emoticon({
    top: 30,
    right: 30,
    name: 'happy',
    skin: new Skin({
      fill: 'red'
    }),
    emotion: Emotion.HAPPY,
  })
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

function createAvatar(primaryColor, secondaryColor) {
  const avatar = new Avatar({
    width: 320,
    height: 240,
    name: 'avatar',
    primaryColor,
    secondaryColor,
    props: {
      autoUpdateGaze: false,
    },
  })
  const mouth = new AvatarMouth({
    left: 120,
    top: 128,
    name: 'mouth',
    color: 'white',
    skin: new AvatarMouthSkin(),
  })
  avatar.replace(avatar.content('mouth'), mouth)
  return avatar
}

function onLaunch() {
  emoticon = createHeartEmoticon()
  ap = new Application(null, {
    displayListLength: 4096,
    ...fluid,
    skin: new Skin({ fill: 'white' }),
    contents: [createAvatar('white', 'black')],
  })
  mouth = ap.content('avatar').content('mouth')
  return ap
}

function renderSpeech(str) {
  if (ap.content('balloon') == null) {
    const balloon = new MarqueeLabel({
      state: 0,
      bottom: 10,
      right: 10,
      width: 180,
      height: 40,
      name: 'balloon',
      string: str,
    })
    ap.add(balloon)
    const avatar = ap.content('avatar')
    avatar && avatar.delegate('startSpeech')
  }
}

function removeSpeech() {
  const balloon = ap.content('balloon')
  if (balloon != null) {
    ap.remove(balloon)
    const avatar = ap.content('avatar')
    avatar && avatar.delegate('stopSpeech')
  }
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

function onRobotCreated(theRobot, d) {
  robot = theRobot
  Digital = d
}

async function onButtonChange(button, pressed) {
  if (!pressed) {
    return
  }
  try {
    let pose
  switch (button) {
    case 'A':
      Timer.delay(500)
      pose = {
        yaw: - Math.PI / 6,
        pitch: 0,
      }
      await applyPoseAsync(robot, pose)
      ap.add(emoticon)
      mouth.state = 1
      await speak(speeches.thankyou)
      ap.remove(emoticon)
      mouth.state = 0
      Timer.delay(500)
      pose = {
        yaw: -Math.PI / 4,
        pitch: 0,
      }
      await applyPoseAsync(robot, pose)
      await speak(speeches.keshimasu)
      Digital.write(21, 1)
      break
    case 'B':
      Digital.write(21, 0)
      break
    case 'C':
      break
  }
} catch {
    trace('error')
}
}

export default {
  onLaunch,
  onRobotCreated,
  onButtonChange,
  autoLoop: false,
}
