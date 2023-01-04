let robot
function onRobotCreated(r) {
  robot = r
}
function onButtonChange(button, pressed) {
  if (button === 'A' && pressed) {
    robot.say('こんにちは')
  }
}

export default {
  onButtonChange,
  onRobotCreated
}
