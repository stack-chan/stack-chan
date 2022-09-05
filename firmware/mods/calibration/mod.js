import Timer from 'timer'
let robot
let pan
let tilt
let active = false
async function onRobotCreated(r) {
  robot = r
  pan = r._driver._pan
  tilt = r._driver._tilt
  await pan.setOffsetAngle(0)
  await tilt.setOffsetAngle(0)
  Timer.repeat(async () => {
    active = true
    const { angle: panAngle } = await pan.readStatus()
    const { angle: tiltAngle } = await tilt.readStatus()
    const panOffset = await pan.readOffsetAngle()
    const tiltOffset = await tilt.readOffsetAngle()
    trace(`(pan, tilt) => (${panAngle}, ${tiltAngle}), (panOffset, tiltOffset) => (${panOffset}, ${tiltOffset})\n`)
    active = false
  }, 1000)
}

async function onButtonChange(button, pressed) {
  if (!pressed) {
    return
  }
  switch (button) {
    case 'A':
      trace('setting pan offset\n')
      const { angle: panAngle } = await pan.readStatus()
      active = true
      await pan.setOffsetAngle(panAngle - 90)
      await pan.saveSettings()
      break
    case 'B':
      trace('setting tilt offset\n')
      const { angle: tiltAngle } = await tilt.readStatus()
      await tilt.setOffsetAngle(tiltAngle - 90)
      await tilt.saveSettings()
      break
    case 'C':
      trace('setting zero\n')
      await tilt.setAngle(100)
      await pan.setAngle(100)
      Timer.set(async () => {
        await tilt.setTorque(false)
        await pan.setTorque(false)
      }, 500)
      break
  }
}

export default {
  onRobotCreated,
  onButtonChange,
  autoLoop: false,
}
