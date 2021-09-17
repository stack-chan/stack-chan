/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import Avatar from 'avatar'
import MarqueeLabel from 'marquee-label'
import { Application, Container, Skin } from 'piu/MC'
import ttsResources from 'speeches'
const speeches = ttsResources.speeches
/* global trace, SharedArrayBuffer */

const sentense1 = 'スタックチャンは手乗りサイズのコミュニケーションロボットです。'
const sentense2 = '首を振ったり、あなたを見たり、喋ったり笑ったりします。'
let robot
let ap

const fluid = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

function createAvatar(primaryColor, secondaryColor) {
  return new Avatar({
    width: 320,
    height: 240,
    name: 'avatar',
    primaryColor,
    secondaryColor,
    props: {
      autoUpdateGaze: false,
    },
  })
}

function onLaunch() {
  ap = new Application(null, {
    displayListLength: 4096,
    ...fluid,
    skin: new Skin({ fill: 'white' }),
    contents: [createAvatar('white', 'black')],
  })
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

function onRobotCreated(theRobot) {
  robot = theRobot
}

function onButtonChange(button, pressed) {
  if (!pressed) {
    return
  }
  switch (button) {
    case 'A':
      speak(speeches.stackchanIn30Seconds)
      break
    case 'B':
      speak(sentense1)
      break
    case 'C':
      speak(speeches.sentense2)
      break
  }
}

export default {
  onLaunch,
  onRobotCreated,
  onButtonChange,
  autoLoop: false,
}
