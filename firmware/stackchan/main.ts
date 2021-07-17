declare const global: any

import Timer from 'timer'
import Avatar from 'avatar'
import { Application, Color, Skin } from 'piu/MC'
import { hsl } from 'piu/All'
import CombTransition from 'piu/CombTransition'
import MarqueeLabel from 'marquee-label'
import { Robot, Target } from 'robot'
import { RS30XDriver } from 'rs30x-driver'

const SPEECH_STR =
  'わが輩は猫である。名前はまだ無い。どこで生れたかとんと見当けんとうがつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。'

const fluid = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

const balloon = new MarqueeLabel({
  state: 0,
  bottom: 10,
  right: 10,
  width: 180,
  height: 40,
  name: 'balloon',
  string: SPEECH_STR,
})

function createAvatar(primaryColor: Color, secondaryColor: Color) {
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

let avatar = createAvatar('white', 'black')
const ap = new Application(null, {
  displayListLength: 4096,
  ...fluid,
  skin: new Skin({ fill: 'white' }),
  contents: [
    avatar
  ],
})

function swapFace(primaryColor, secondaryColor) {
  const av = createAvatar(primaryColor, secondaryColor)
  const transition = new CombTransition(250, Math.quadEaseOut, "horizontal", 4);
  avatar = av
  ap.run(transition, ap.first, av);
}

const robot = new Robot({
  renderer: {
    render(face) {
      for (const eye of face.eyes) {
        const {yaw, pitch} = eye.gaze
        const eyeContent = avatar.content(eye.name)
        eyeContent.delegate("onGazeChange", {
          x: Math.sin(yaw),
          y: Math.sin(pitch)
        })
      }
    }
  },
  driver: new RS30XDriver({
    panId: 0x01, tiltId: 0x02
  }),
  eyes: [{
    name: 'leftEye',
    position: {
      x: 0.03,
      y: -0.0085,
      z: 0.0,
    },
  }, {
    name: 'rightEye',
    position: {
      x: 0.03,
      y: 0.0085,
      z: 0.0,
    },
  }]
})

const target = new Target(0.1, 0.0, -0.03)
robot.follow(target)

let isFollowing = false

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

if (global.button != null) {
  global.button.a.onChanged = function () {
    if (this.read()) {
      isFollowing = !isFollowing
      if (isFollowing) {
        robot.follow(target)
      } else {
        robot.unfollow()
      }
    }
  }
  global.button.b.onChanged = function () {
    if (this.read()) {
      const primaryColor = hsl(randomBetween(0, 360), 1.0, 0.5)
      const secondaryColor = hsl(randomBetween(0, 360), 1.0, 0.5)
      swapFace(primaryColor, secondaryColor)
    }
  }
}

function randomBetween(low: number, high: number): number {
  return Math.random() * (high - low) + low
}

let isLeft = true
const targetLoop = () => {
  const x = 0.2 // randomBetween(0.2, 1.0)
  const y = isLeft ? 0.2 : -0.0 // randomBetween(-1.0, 1.0)
  const z = 0.0 // randomBetween(0.0, 1.0)
  trace(`looking at: (${x}, ${y}, ${z})\n`)
  target.x = x
  target.y = y
  target.z = z
  isLeft = !isLeft
}

Timer.repeat(targetLoop, 5000)
