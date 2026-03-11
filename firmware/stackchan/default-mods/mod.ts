import { onRobotCreated } from 'default-mods/on-robot-created'
import { onLaunch } from 'default-mods/on-launch'
import type { Robot } from 'robot'

export type LaunchOptions = {
  forceSetup?: boolean
}

export interface StackchanMod {
  onLaunch?: (option?: LaunchOptions) => Promise<boolean> | boolean
  onRobotCreated?: (robot: Robot, option?: unknown) => Promise<void> | void
}

export default {
  onRobotCreated,
  onLaunch,
}
