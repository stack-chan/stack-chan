import type { StackchanAppBehavior } from 'app-behavior'

const behavior: StackchanAppBehavior = {
  onContextCreated() {
    throw new Error('[MiniApp Lin Smoke] SDK archive MOD was not loaded')
  },
}

export default behavior
