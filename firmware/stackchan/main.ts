declare const global: any

import Timer from 'timer'
import Avatar from 'avatar'
import Modules from 'modules'
import { Application, Color, Container, Skin } from 'piu/MC'
import { hsl } from 'piu/All'
import CombTransition from 'piu/CombTransition'
import { Robot, Target } from 'robot'
import { RS30XDriver } from 'rs30x-driver'
import { PWMServoDriver } from 'sg90-driver'

const fluid = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

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

let ap: Application
let avatar

let onLaunch
let onButtonChange
let onRobotCreated
let autoLoop = true

trace(`modules of mod: ${JSON.stringify(Modules.archive)}\n`)
trace(`modules of host: ${JSON.stringify(Modules.host)}\n`)

if (Modules.has("mod")) {
  const mod = Modules.importNow("mod")
  onLaunch = mod.onLaunch
  onButtonChange = mod.onButtonChange
  onRobotCreated = mod.onRobotCreated
  autoLoop = mod.autoLoop ?? true
  if (typeof onLaunch === "function") {
    ap = onLaunch()
  }
}

if (ap == null) {
  avatar = createAvatar('white', 'black')
  ap = new Application(null, {
    displayListLength: 4096,
    ...fluid,
    skin: new Skin({ fill: 'white' }),
    contents: [
      avatar
    ],
  })
}

function swapFace(primaryColor, secondaryColor) {
  const av = createAvatar(primaryColor, secondaryColor)
  const transition = new CombTransition(250, Math.quadEaseOut, "horizontal", 4);
  ap.run(transition, ap.first, av);
}

const robot = new Robot({
  renderer: {
    render(face) {
      for (const eye of face.eyes) {
        const avatar = ap.content("avatar") as Container
        if (avatar == null) {
          return
        }
        const { yaw, pitch } = eye.gaze
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
  // driver: new PWMServoDriver(),
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

let target
if (typeof onRobotCreated === "function") {
  onRobotCreated(robot)
} else {
  target = new Target(0.1, 0.0, -0.03)
  robot.follow(target)
}

let isFollowing = false

if (global.button != null) {
  global.button.a.onChanged = function () {
    if (typeof onButtonChange === "function") {
      onButtonChange("A", this.read())
    } else if (this.read()) {
      isFollowing = !isFollowing
      if (isFollowing) {
        robot.follow(target)
      } else {
        robot.unfollow()
      }
    }
  }
  global.button.b.onChanged = function () {
    if (typeof onButtonChange === "function") {
      onButtonChange("B", this.read())
    } else if (this.read()) {
      const primaryColor = hsl(randomBetween(0, 360), 1.0, 0.5)
      const secondaryColor = hsl(randomBetween(0, 360), 1.0, 0.5)
      swapFace(primaryColor, secondaryColor)
    }
  }
  global.button.c.onChanged = function () {
    if (typeof onButtonChange === "function") {
      onButtonChange("C", this.read())
    }
  }
}

function randomBetween(low: number, high: number): number {
  return Math.random() * (high - low) + low
}

const targetLoop = () => {
  const x = randomBetween(0.4, 1.0)
  const y = randomBetween(-0.4, 0.4)
  const z = randomBetween(-0.02, 0.2)
  if (target != null) {
    trace(`looking at: (${x}, ${y}, ${z})\n`)
    target.x = x
    target.y = y
    target.z = z
  }
}

if (autoLoop) {
  Timer.repeat(targetLoop, 5000)
}
