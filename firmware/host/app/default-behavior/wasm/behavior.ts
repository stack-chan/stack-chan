import type { StackchanAppBehavior } from 'app-behavior'
import { onClose, onContextCreated } from 'app-default-behavior/on-context-created'
import { onLaunch } from 'app-default-behavior/wasm/on-launch'

const behavior: StackchanAppBehavior = {
  onLaunch,
  onContextCreated,
  onClose,
}

export default behavior
