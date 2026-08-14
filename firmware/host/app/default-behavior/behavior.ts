import type { StackchanAppBehavior } from 'app-behavior'
import { onContextCreated } from 'app-default-behavior/on-context-created'

const behavior: StackchanAppBehavior = {
  onContextCreated,
}

export default behavior
