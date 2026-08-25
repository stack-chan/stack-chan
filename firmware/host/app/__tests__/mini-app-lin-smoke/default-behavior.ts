import type { StackchanAppBehavior } from 'app-behavior'

const behavior: StackchanAppBehavior = {
  onLaunch() {
    return true
  },
  onContextCreated() {
    throw new Error('[MiniApp Lin Smoke] combined archive MOD was not loaded')
  },
}

export default behavior
