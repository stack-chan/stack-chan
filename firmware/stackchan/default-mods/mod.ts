import { onRobotCreated } from 'default-mods/on-robot-created'
import { onLaunch } from 'default-mods/on-launch'
import type { Robot } from 'robot'

export interface StackchanMod {
  onLaunch?: () => Promise<undefined | boolean> | undefined | boolean
  onRobotCreated?: (robot: Robot, option?: unknown) => Promise<undefined> | undefined
}

export default {
  onRobotCreated,
  onLaunch,
}
