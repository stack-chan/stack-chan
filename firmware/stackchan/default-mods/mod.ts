import { onRobotCreated } from 'default-mods/on-robot-created'
import { onLaunch } from 'default-mods/on-launch'
import { Robot } from 'robot'

export interface StackchanMod {
  onLaunch?: () => Promise<void | boolean> | void | boolean
  onRobotCreated?: (robot: Robot, option?: unknown) => Promise<void> | void
}

export default {
  onRobotCreated,
  onLaunch,
}
