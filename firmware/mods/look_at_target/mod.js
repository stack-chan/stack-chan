import Timer from 'timer'
import { Target } from 'robot'
let flag = false

function onRobotCreated(robot) {
  const target = new Target(0.6, 0, 0)
  robot.follow(target)
  Timer.repeat(() => {
    target.y = flag ? 0.7 : -0.7
    flag = !flag
  }, 3000)
}
export default {
  onRobotCreated,
  autoLoop: false
}
