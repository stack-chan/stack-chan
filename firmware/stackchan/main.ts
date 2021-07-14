declare const global: any

import Timer from 'timer'
import RS30X, { Rotation, RS30XBatch, TorqeMode } from 'rs30x'

import Avatar from 'avatar'
import { Application, Skin } from 'piu/MC'
import MarqueeLabel from 'marquee-label'
import { Robot, Target } from 'robot'
import type { Vector3 } from 'robot'

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

const target = new Target(0.1, 0.0, 0.0)
robot.follow(target)

let isMoving = false
let isFollowing = false
let handler: ReturnType<typeof Timer.set> | null = null

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
  global.button.c.onChanged = function () {
    if (this.read()) {
      if (isMoving) {
        if (handler != null) {
          Timer.clear(handler)
          handler = null
        }
        isMoving = false
      } else {
        if (handler == null) {
          handler = Timer.set(loop, 300)
        }
        isMoving = true
      }
    }
  }
}

const pan = new RS30X({
  id: 1,
})
const tilt = new RS30X({
  id: 2,
})
// tilt.flashId(2)
// pan.setTorqueMode(TorqeMode.ON)
// tilt.setTorqueMode(TorqeMode.ON)
tilt.setComplianceSlope(Rotation.CW, 0x24)
tilt.setComplianceSlope(Rotation.CCW, 0x24)

// const batch = new RS30XBatch([pan, tilt])

function randomBetween(low: number, high: number): number {
  return Math.random() * (high - low) + low
}

function loop() {
  pan.setTorqueMode(TorqeMode.ON)
  tilt.setTorqueMode(TorqeMode.ON)
  const time = randomBetween(0.3, 1.2)
  const panAngle = randomBetween(-30, 30)
  pan.setAngleInTime(panAngle, time)
  const tiltAngle = randomBetween(-10, 30)
  tilt.setAngleInTime(tiltAngle, time)
  Timer.set(() => {
    pan.setTorqueMode(TorqeMode.OFF)
    tilt.setTorqueMode(TorqeMode.OFF)
  }, time * 1000 + 10)
  handler = Timer.set(loop, randomBetween(2000, 6000))
}
if (isMoving) {
  handler = Timer.set(loop, 3000)
}
/*
Timer.set(() => {
  // batch.playMotion({
  //   duration: 2000,
  //   cuePoints: [0, 0.1, 0.2, 0.3, 0.5, 1.0],
  //   keyFrames: [
  //     [null, null, null, -20, null, 20],
  //     [null, -20, null, 0, null, -20],
  //   ],
  // })
  const time = randomBetween(0.3, 1.2)
  const panAngle = randomBetween(-30, 30)
  pan.setAngleInTime(panAngle, time)
  const tiltAngle = randomBetween(-10, 30)
  tilt.setAngleInTime(tiltAngle, time)
}, 3000)
*/

let count = 0
Timer.repeat(() => {
  count += 1
  target.x = 0.2
  target.y = 0.2 * Math.sin((Math.PI / 10) * count)
  let status = pan.readStatus()
  const yaw = Math.PI * status.angle / 180
  trace(
    `pan...angle: ${status.angle}, time: ${status.time}, speed: ${status.speed}, current: ${status.current}, voltage: ${status.voltage}\n`
  )
  status = tilt.readStatus()
  const pitch = Math.PI * status.angle / 180
  trace(
    `tilt...angle: ${status.angle}, time: ${status.time}, speed: ${status.speed}, current: ${status.current}, voltage: ${status.voltage}\n`
  )
  robot.onPoseChange({
    yaw,
    pitch,
    roll: 0
  })
}, 100)
