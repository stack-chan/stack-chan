import { onContextCreated } from 'app-default-behavior/on-context-created'
import { onLaunch } from 'app-default-behavior/on-launch'
import { installMemoryControls } from 'memory-diagnostics/runtime'

export default {
  onLaunch,
  async onContextCreated(robot, options) {
    await onContextCreated(robot, options)
    installMemoryControls(robot)
  },
}
