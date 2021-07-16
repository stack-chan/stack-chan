declare const global: any

import Timer from 'timer'
import Avatar from 'avatar'
import { Application, Skin } from 'piu/MC'
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

const avatar = new Avatar({
  width: 320,
  height: 240,
  name: 'avatar',
  props: {
    autoUpdateGaze: false,
    autoUpdateBreath: true
  }
})

const ap = new Application(null, {
  displayListLength: 4096,
  ...fluid,
  skin: new Skin({ fill: 'white' }),
  contents: [
    avatar
  ],
})

const leftEye = avatar.content("leftEye")
const rightEye = avatar.content("rightEye")

const robot = new Robot({
  driver: new RS30XDriver({
    panId: 0x01, tiltId: 0x02
  }),
  eyes: [{
    position: {
      x: 0.03,
      y: -0.0085,
      z: 0.0,
    },
    onGazeChange: (yaw, pitch) => {
      leftEye.delegate("onGazeChange", {
        x: Math.sin(yaw),
        y: Math.sin(pitch)
      })
    }
  }, {
    position: {
      x: 0.03,
      y: 0.0085,
      z: 0.0,
    },
    onGazeChange: (yaw, pitch) => {
      rightEye.delegate("onGazeChange", {
        x: Math.sin(yaw),
        y: Math.sin(pitch)
      })
    }
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
      // startSpeech()
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
      target.y = target.y + 0.01
      // stopSpeech()
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

let count = 0
/*
Timer.repeat(() => {
  count += 1
  target.x = 0.2
  target.y = 0.2 * Math.sin((Math.PI / 10) * count)
}, 100)
*/
