declare const global: any

import { Button } from 'button'
import config from 'mc/config'
import Modules from 'modules'
import { Container } from 'piu/MC'
import { Robot } from 'robot'
// import { RS30XDriver } from 'rs30x-driver'
import { SCServoDriver } from 'scservo-driver'
import { PWMServoDriver } from 'sg90-driver'
import { defaultMod, StackchanMod } from 'stackchan-mod'

trace(`modules of mod: ${JSON.stringify(Modules.archive)}\n`)
trace(`modules of host: ${JSON.stringify(Modules.host)}\n`)

let { onLaunch, onButtonChange, onRobotCreated } = defaultMod
if (Modules.has("mod")) {
  const mod = Modules.importNow("mod") as StackchanMod
  onLaunch = mod.onLaunch ?? onLaunch
  onButtonChange = mod.onButtonChange ?? onButtonChange
  onRobotCreated = mod.onRobotCreated ?? onRobotCreated
}

const ap = onLaunch?.()
if (ap == null) {
  throw new Error("Application not created")
}

if (globalThis.button == null) {
  trace('adding pseudo buttons for M5Stack Core2\n')
  const buttons = new Row(null, {
    left: 0,
    right: 0,
    top: 240,
    height: 40,
    skin: new Skin({ fill: 'yellow' }),
    contents: [
      new Button({ name: 'A', color: 'red', onButtonChange }),
      new Button({ name: 'B', color: 'green', onButtonChange }),
      new Button({ name: 'C', color: 'blue', onButtonChange }),
    ]
  })
  ap.add(buttons)
}

const driver = config.servo?.driver === "ttl" ? new SCServoDriver({
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

onRobotCreated?.(robot)

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
