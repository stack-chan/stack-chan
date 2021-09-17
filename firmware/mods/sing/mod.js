/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import Avatar, { Emotion } from 'avatar'
import Emoticon from 'emoticon'
import MarqueeLabel from 'marquee-label'
import { Application, Container, Skin } from 'piu/MC'
import Timer from 'timer'
/* global trace, SharedArrayBuffer */

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
      autoUpdateBlink: false,
    },
  })
}

let idx = 0

function createNote() {
  return new Emoticon({
    top: 30,
    right: 30,
    name: 'note',
    emotion: Emotion.COLD,
  })
}

function onLaunch() {
  ap = new Application(null, {
    displayListLength: 4096,
    ...fluid,
    skin: new Skin({ fill: 'white' }),
    contents: [createAvatar('white', 'black'), createNote()],
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
}

function onRobotCreated(theRobot) {
  robot = theRobot
}

let flag = false
function onButtonChange(button, pressed) {
  if (!pressed) {
    return
  }
  let emoticon
  let leftEye, rightEye
  switch (button) {
    case 'A':
      leftEye = ap.content('avatar').content('leftEye').content('eyelid')
      leftEye.variant = 2
      rightEye = ap.content('avatar').content('rightEye').content('eyelid')
      rightEye.variant = 2
      break
    case 'B':
      if (flag) {
        renderSpeech('lullabye...lullabye...')
      } else {
        removeSpeech()
      }
      flag = !flag
      break
    case 'C':
      break
  }
}

export default {
  onLaunch,
  onRobotCreated,
  onButtonChange,
  autoLoop: true,
}
