import type { StackchanContext } from 'capabilities'
import { onLaunch } from 'default-mods/on-launch'
import { onRobotCreated } from 'default-mods/on-robot-created'

export interface StackchanMod {
  onLaunch?: () => Promise<boolean> | boolean
  onRobotCreated?: (context: StackchanContext, option?: unknown) => Promise<void> | void
}

export default {
  onRobotCreated,
  onLaunch,
}
