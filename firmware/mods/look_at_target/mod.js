import Timer from 'timer'
let flag = false

function onRobotCreated(robot) {
  Timer.repeat(() => {
    robot.lookAt([0.4, flag ? 0.2 : -0.2, 0.0])
    flag = !flag
  }, 3000)
}
export default {
  onRobotCreated,
}
