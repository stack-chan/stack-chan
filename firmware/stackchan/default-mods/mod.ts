import { onRobotCreated } from 'default-mods/on-robot-created'
import { onLaunch } from 'default-mods/on-launch'
import { Robot } from 'robot'

export interface StackchanMod {
  onLaunch?: () => void | boolean
  onRobotCreated?: (robot: Robot, option?: any) => void
}

export default {
  onRobotCreated,
  onLaunch,
}
