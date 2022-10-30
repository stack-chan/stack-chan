declare const global: any

import config from 'mc/config'
import Modules from 'modules'
import { Robot } from 'robot'
// import { RS30XDriver } from 'rs30x-driver'
import { SCServoDriver } from 'scservo-driver'
import { PWMServoDriver } from 'sg90-driver'
import { defaultMod, StackchanMod } from 'stackchan-mod'
import { Renderer } from 'face-renderer'

// trace(`modules of mod: ${JSON.stringify(Modules.archive)}\n`)
// trace(`modules of host: ${JSON.stringify(Modules.host)}\n`)

/*
new Robot({
  driver: new SCServoDriver({
    panId: 0x01,
    tiltId: 0x02,
  })
  ,
  renderer: new Renderer
})
*/

let { onLaunch, onButtonChange, onRobotCreated, onApplicationCreated } = defaultMod
if (Modules.has('mod')) {
  const mod = Modules.importNow('mod') as StackchanMod
  onLaunch = mod.onLaunch ?? onLaunch
  onButtonChange = mod.onButtonChange ?? onButtonChange
  onRobotCreated = mod.onRobotCreated ?? onRobotCreated
  onApplicationCreated = mod.onApplicationCreated ?? onApplicationCreated
}

const ap = onLaunch?.()
if (ap == null) {
  // throw new Error('Application not created')
  trace('application not created\n')
} else {
  onApplicationCreated(ap)
}

const driver =
  config.servo?.driver === 'scservo'
    ? new SCServoDriver({
      panId: 0x01,
      tiltId: 0x02,
    })
    : new PWMServoDriver()
const renderer = new Renderer
const robot = new Robot({
  driver,
  renderer,
})

onRobotCreated?.(robot)

if (global.button != null) {
  global.button.a.onChanged = function () {
    onButtonChange('A', this.read())
  }
  global.button.b.onChanged = function () {
    onButtonChange('B', this.read())
  }
  global.button.c.onChanged = function () {
    onButtonChange('C', this.read())
  }
}
