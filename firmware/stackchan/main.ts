declare const global: any

import Timer from 'timer'
import Avatar from 'avatar'
import Modules from 'modules'
import { Application, Color, Container, Content } from 'piu/MC'
import { hsl } from 'piu/All'
import CombTransition from 'piu/CombTransition'
import { Robot, Target } from 'robot'
import { RS30XDriver } from 'rs30x-driver'
import { PWMServoDriver } from 'sg90-driver'
import config from 'mc/config'

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
let avatar: Content

let onLaunch: () => Application
let onButtonChange: (buttonName: string, pressed: boolean) => void
let onRobotCreated: (robot: Robot) => void
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

// TODO: separate into modules
class ButtonBehavior extends Behavior {
  onTouchBegan(content, id, x, y, tick) {
    trace(`button ${content.name} touch began: ${id}, (${x}, ${y}), ${tick}\n`)
		onButtonChange(content.name, true)
	}
  onTouchEnded(content, id, x, y, tick) {
    trace(`button ${content.name} touch ended: ${id}, (${x}, ${y}), ${tick}\n`)
		onButtonChange(content.name, false)
	}
}

const Button = Content.template(({ name, color = 'white' }) => ({
  name,
  active: true,
  ...fluid,
  skin: new Skin({fill: color}),
  Behavior: ButtonBehavior
}))

if (ap == null) {
  avatar = createAvatar('white', 'black')
  const contents = [ avatar ]
  if (globalThis.button == null) {
    trace('adding pseudo buttons for M5Stack Core2\n')
    const buttons = new Row(null, {
      left: 0,
      right: 0,
      top: 240,
      height: 40,
      skin: new Skin({ fill: 'yellow' }),
      contents: [
        new Button({name: 'A', color: 'red'}),
        new Button({name: 'B', color: 'green'}),
        new Button({name: 'C', color: 'blue'}),
      ]
    })
    contents.push(buttons)
  }
  ap = new Application(null, {
    displayListLength: 4096,
    left: 0,
    top: 0,
    width: 320,
    height: 240,
    skin: new Skin({ fill: 'white' }),
    contents,
  })
}

function swapFace(primaryColor, secondaryColor) {
  const av = createAvatar(primaryColor, secondaryColor)
  const transition = new CombTransition(250, Math.quadEaseOut, "horizontal", 4);
  ap.run(transition, ap.content("avatar"), av);
}

const driver = config.servo?.driver === "tts" ? new RS30XDriver({
  panId: 0x01, tiltId: 0x02
}) : new PWMServoDriver()
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
  driver,
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
function defaultOnButtonChange(button: 'A' | 'B' | 'C', isPressed: boolean): void {
  if (!isPressed) {
    return
  }
  switch (button) {
    case 'A':
      isFollowing = !isFollowing
      if (isFollowing) {
        robot.follow(target)
      } else {
        robot.unfollow()
      }
      break
    case 'B':
      const primaryColor = hsl(randomBetween(0, 360), 1.0, 0.5)
      const secondaryColor = hsl(randomBetween(0, 360), 1.0, 0.5)
      swapFace(primaryColor, secondaryColor)
      break
    case 'C':
      /* noop */
      break
  }
}

if (typeof onRobotCreated === "function") {
  onRobotCreated(robot)
} else {
  target = new Target(0.1, 0.0, -0.03)
  robot.follow(target)
}

if (typeof onButtonChange !== "function") {
  onButtonChange = defaultOnButtonChange
}

let isFollowing = false

if (global.button != null) {
  global.button.a.onChanged = function () {
    onButtonChange("A", this.read())
  }
  global.button.b.onChanged = function () {
    onButtonChange("B", this.read())
  }
  global.button.c.onChanged = function () {
    onButtonChange("C", this.read())
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
