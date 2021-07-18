import Timer from 'timer'
import Avatar from 'avatar'
import MarqueeLabel from 'marquee-label'
import { Application, Container, Skin } from 'piu/MC'
let ap

const fluid = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

function startSpeech() {
  if (ap.content('balloon') == null) {
    ap.add(balloon)
    const avatar = ap.content('avatar')
    avatar && avatar.delegate('startSpeech')
  }
}

function stopSpeech() {
  if (ap.content('balloon') != null) {
    ap.remove(balloon)
    const avatar = ap.content('avatar')
    avatar && avatar.delegate('stopSpeech')
  }
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

const SPEECH_STR =
  'わが輩は猫である。名前はまだ無い。どこで生れたかとんと見当けんとうがつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。'

const balloon = new MarqueeLabel({
  state: 0,
  bottom: 10,
  right: 10,
  width: 180,
  height: 40,
  name: 'balloon',
  string: SPEECH_STR,
})

function onLaunch() {
  ap = new Application(null, {
    displayListLength: 4096,
    ...fluid,
    skin: new Skin({ fill: 'white' }),
    contents: [
      createAvatar('white', 'black'),
    ],
  })
  return ap
}

function onButtonChange(button, pressed) {
  if (button === "A" && pressed) {
    startSpeech()
  } else if (button === "B" && pressed) {
    stopSpeech()
  }
}

export default {
  onButtonChange,
  onLaunch
}
