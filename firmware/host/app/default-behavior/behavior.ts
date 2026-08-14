import type { StackchanAppBehavior } from 'app-behavior'
import { onContextCreated } from 'app-default-behavior/on-context-created'
import { onLaunch } from 'app-default-behavior/on-launch'

const behavior: StackchanAppBehavior = {
  onLaunch,
  onContextCreated,
}

export default behavior
