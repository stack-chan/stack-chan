let robot
let isRight = false
function onRobotCreated(r) {
  robot = r
}

function onButtonChange(button, pressed) {
  if (!pressed) {
    return
  }
  switch (button) {
    case 'A':
      trace('flashing id 0x02')
      robot._driver._pan.flashId(0x02)
      break
    case 'B':
      const angle = isRight ? 10 : -10
      trace(`changing angle to ${angle}`)
      robot._driver._pan.setAngleInTime(angle, 0.3)
      isRight = !isRight
      break
    case 'C':
      speak(speeches.sentense2)
      break
  }
}

export default {
  onRobotCreated,
  onButtonChange,
  autoLoop: false,
}
