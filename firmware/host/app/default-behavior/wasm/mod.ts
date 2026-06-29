import type { StackchanContext } from 'capabilities'
import { onRobotCreated } from 'default-mods/on-robot-created'
import { onLaunch } from 'default-mods/wasm/on-launch'

export interface StackchanMod {
  onLaunch?: () => Promise<boolean> | boolean
  onRobotCreated?: (context: StackchanContext, option?: unknown) => Promise<void> | void
}

export default {
  onRobotCreated,
  onLaunch,
}
